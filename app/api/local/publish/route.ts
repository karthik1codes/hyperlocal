import { NextResponse } from "next/server";
import { createPredictionMarket, formatBentoError } from "@/lib/bento/actions";
import { hasBentoCredentials } from "@/lib/bento/config";
import { fetchMarket } from "@/lib/bento/client";
import { loadLocalPrediction, saveLocalPrediction } from "@/lib/local/store";
import type { BentoMarketMeta, Card } from "@/lib/scoring/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function pickDuelId(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const tryId = (v: unknown): string | null =>
    typeof v === "string" && v.length > 4 && !v.startsWith("local-") ? v : null;

  for (const key of ["duelId", "duel_id", "id"]) {
    const id = tryId(r[key]);
    if (id) return id;
  }
  // MutationAccepted envelope: { kind, raw: { duelId, … } }
  const raw = r.raw;
  if (raw && typeof raw === "object") {
    const n = raw as Record<string, unknown>;
    for (const key of ["duelId", "duel_id", "id"]) {
      const id = tryId(n[key]);
      if (id) return id;
    }
  }
  const nested = r.result ?? r.data ?? r.duel;
  if (nested && typeof nested === "object") {
    const n = nested as Record<string, unknown>;
    for (const key of ["duelId", "duel_id", "id"]) {
      const id = tryId(n[key]);
      if (id) return id;
    }
  }
  return null;
}

function bindLiveMarket(card: Card, duel: Awaited<ReturnType<typeof fetchMarket>>, localLogin: string): Card {
  const d = duel as Record<string, unknown>;
  const days = Math.max(1, Math.round(Number(duel.endsIn || 0) / 86_400) || 90);
  const duelId = String(duel.duelId);
  const question =
    (typeof d.question === "string" && d.question) ||
    (typeof d.betString === "string" && d.betString) ||
    card.market?.question ||
    card.name;
  const duelOpts =
    Array.isArray(duel.options) && duel.options.length >= 2
      ? duel.options.map(String)
      : null;
  const localOpts =
    card.market?.options && card.market.options.length >= 2
      ? card.market.options.map(String)
      : null;
  const bare = (s: string) => /^(yes|no)$/i.test(s.trim());
  const junk = (s: string) =>
    /resolve yes/i.test(s) || /^yes\s*—\s*[“"]?who\b/i.test(s) || s.length > 90;
  const good = (opts: string[]) => opts.every((s) => !bare(s) && !junk(s));
  // Prefer crawl-derived outcome labels over Bento's bare Yes/No
  const options = good(localOpts || [])
    ? localOpts!
    : good(duelOpts || [])
      ? duelOpts!
      : localOpts || duelOpts || ["Yes — the outcome happens", "No — the outcome fails"];

  const market: BentoMarketMeta = {
    duelId,
    dbId: String(d.dbId ?? d.id ?? duelId),
    duelType: String(duel.duelType || "prediction"),
    options,
    collateralMode: duel.collateralMode === "usdc" ? "usdc" : "credits",
    totalBetAmountUsdc: Number(duel.totalBetAmountUsdc ?? 0),
    uniqueParticipants: Number(duel.uniqueParticipants ?? 0),
    status: Number(duel.status ?? 1),
    category: String(duel.category || card.market?.category || "Hyper-Local"),
    description: `${card.market?.description || ""}\n\nOpened from local card ${localLogin}`.trim(),
    endsIn: Number(duel.endsIn ?? days * 86_400),
    question: String(question),
    source: "bento",
    conditionId: null,
    marketMakerAddress: null,
    slug: duelId,
    externalUrl: card.market?.externalUrl ?? null,
  };
  return { ...card, market };
}

/**
 * Turn a hyper-local scout card into a live Bento YES/NO prediction
 * so the user can stake credits, see odds, and save the bet in MY BETS.
 */
export async function POST(req: Request) {
  if (!hasBentoCredentials()) {
    return NextResponse.json(
      { error: "Set BENTO_BUILDER_API_KEY to open predictions." },
      { status: 503 },
    );
  }
  try {
    const body = (await req.json()) as {
      token?: string;
      login?: string;
      card?: Card;
      address?: string;
    };
    if (!body.token) {
      return NextResponse.json({ error: "token required" }, { status: 400 });
    }

    const login = (body.login || body.card?.login || "").trim().replace(/^@/, "");
    if (!login.startsWith("local-")) {
      return NextResponse.json(
        { error: "Only hyper-local cards (local-…) can be opened as new predictions." },
        { status: 400 },
      );
    }

    const stored = await loadLocalPrediction(login);
    const card = stored?.card || body.card;
    if (!card?.market) {
      return NextResponse.json({ error: "Local prediction not found." }, { status: 404 });
    }

    // Already published
    if (
      card.market.source === "bento" &&
      card.market.duelId &&
      !card.market.duelId.startsWith("local-")
    ) {
      return NextResponse.json({
        ok: true,
        already: true,
        duelId: card.market.duelId,
        card,
        login,
        opensInMs: 0,
      });
    }

    const question = (card.market.question || card.name).trim();
    const endsIn = Number(card.market.endsIn || 0);
    const deadlineDays =
      endsIn > 86_400 ? Math.round(endsIn / 86_400) : endsIn > 0 ? Math.max(1, Math.round(endsIn / 86_400)) : 90;

    const sourceCover =
      (stored?.hit.imageUrl && stored.hit.imageUrl.startsWith("http") && stored.hit.imageUrl) ||
      (card.avatarUrl?.startsWith("http") ? card.avatarUrl : null) ||
      (card.cardImageUrl?.startsWith("http") ? card.cardImageUrl : null) ||
      undefined;

    const created = await createPredictionMarket({
      token: body.token,
      question,
      // Bento createDuel only accepts sport categories — mapping happens inside createPredictionMarket
      category: card.market.category || "Hyper-Local",
      description:
        card.market.description ||
        `Hyper-local prediction from ${stored?.region || "local news"}. Origin: ${login}`,
      deadlineDays,
      tags: ["bento", "hyper-local", "prediction", login.slice(0, 40)],
      coverImageUrl: sourceCover,
    });

    const duelId = pickDuelId(created);
    if (!duelId) {
      return NextResponse.json(
        { error: "Prediction created but no duelId returned.", result: created },
        { status: 502 },
      );
    }

    const opensInMs = (created as { opensInMs?: number }).opensInMs ?? 6 * 60_000;
    const userAddress =
      typeof body.address === "string" && /^0x[a-fA-F0-9]{40}$/.test(body.address)
        ? body.address
        : undefined;

    // Poll until catalog sees it (private markets need creator userAddress)
    let duel: Awaited<ReturnType<typeof fetchMarket>> | null = null;
    let lastErr = "";
    for (let i = 0; i < 10; i++) {
      try {
        duel = await fetchMarket(duelId, { userAddress });
        break;
      } catch (e) {
        lastErr = formatBentoError(e);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (!duel) {
      // Still bind with optimistic meta so the client can wait + bet
      const optimistic = {
        ...card,
        market: {
          ...card.market,
          duelId,
          dbId: duelId,
          source: "bento" as const,
          duelType: "prediction",
          options:
            card.market.options?.length >= 2
              ? card.market.options
              : ["Yes — the outcome happens", "No — the outcome fails"],
          collateralMode: "credits" as const,
          status: 1,
          slug: duelId,
        },
      };
      if (stored) {
        await saveLocalPrediction({ ...stored, card: optimistic });
      }
      return NextResponse.json({
        ok: true,
        duelId,
        card: optimistic,
        login,
        opensInMs,
        privacyAccess: (created as { privacyAccess?: string }).privacyAccess ?? "private",
        warning: lastErr || "Market created; waiting for catalog sync.",
      });
    }

    const liveCard = bindLiveMarket(card, duel, login);
    if (stored) {
      await saveLocalPrediction({ ...stored, card: liveCard });
    }

    return NextResponse.json({
      ok: true,
      duelId,
      card: liveCard,
      login,
      opensInMs,
      privacyAccess: (created as { privacyAccess?: string }).privacyAccess ?? "private",
      result: created,
    });
  } catch (e) {
    return NextResponse.json(
      { error: formatBentoError(e) },
      { status: 400 },
    );
  }
}
