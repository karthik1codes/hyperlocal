import { NextResponse } from "next/server";
import { runClubDebate } from "@/lib/club/debate";
import type { ClubState } from "@/lib/club/types";
import type { Card } from "@/lib/scoring/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Agentic Club debate:
 * ingest Bento + card + club evidence → Bull / Bear / Risk → Judge
 * Optional prose polish when OPENAI_API_KEY (or BENTO_DEBATE_LLM_KEY) is set.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      login?: string;
      duelId?: string;
      card?: Card;
      club?: ClubState;
    };

    if (!body.login && !body.duelId && !body.card?.login) {
      return NextResponse.json(
        { error: "Provide login, duelId, or card to debate." },
        { status: 400 },
      );
    }

    const debate = await runClubDebate({
      login: body.login,
      duelId: body.duelId,
      card: body.card,
      club: body.club ?? null,
    });

    return NextResponse.json({ ok: true, debate });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Debate failed" },
      { status: 500 },
    );
  }
}
