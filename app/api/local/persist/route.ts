import { NextResponse } from "next/server";
import type { Card } from "@/lib/scoring/types";
import {
  loadLocalPrediction,
  saveLocalPrediction,
  type StoredLocalPrediction,
} from "@/lib/local/store";

export const dynamic = "force-dynamic";

/**
 * Browser re-persists a just-minted hyper-local card so /local-* pages work
 * across Vercel instances when Redis was missing or the research write failed.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      card?: Card;
      region?: string;
      topic?: string;
      question?: string;
      hit?: StoredLocalPrediction["hit"];
    };
    const card = body.card;
    const login = (card?.login || "").trim().replace(/^@/, "").toLowerCase();
    if (!card?.market || !login.startsWith("local-")) {
      return NextResponse.json(
        { error: "Expected a hyper-local card (local-…)." },
        { status: 400 },
      );
    }

    const existing = await loadLocalPrediction(login);
    const photoHttp =
      (typeof body.hit?.imageUrl === "string" && body.hit.imageUrl.startsWith("http")
        ? body.hit.imageUrl
        : null) ||
      (card.avatarUrl?.startsWith("http") ? card.avatarUrl : null) ||
      (existing?.hit?.imageUrl?.startsWith("http") ? existing.hit.imageUrl : null);

    const cardForSave: Card = {
      ...card,
      login,
      avatarUrl: photoHttp || card.avatarUrl || "",
      cardImageUrl: photoHttp ? null : card.cardImageUrl,
    };

    const row: StoredLocalPrediction = {
      login,
      region: body.region || existing?.region || card.country || "Local",
      topic: body.topic || existing?.topic || card.market.question || card.name,
      question: body.question || existing?.question || card.market.question || card.name,
      hit:
        body.hit ||
        existing?.hit ||
        ({
          title: card.market.question || card.name,
          url: card.market.externalUrl || "",
          sourceHost: "local",
          summary: card.market.description || card.name,
          imageUrl: photoHttp,
        } satisfies StoredLocalPrediction["hit"]),
      card: cardForSave,
      createdAt: existing?.createdAt || Date.now(),
    };

    // Always stamp durable http photo onto hit
    if (photoHttp) {
      row.hit = { ...row.hit, imageUrl: photoHttp };
      row.card = { ...row.card, avatarUrl: photoHttp, cardImageUrl: null };
    }

    const saved = await saveLocalPrediction(row);
    return NextResponse.json({ ok: true, login, redis: saved.redis });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Persist failed";
    console.error("[local/persist]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
