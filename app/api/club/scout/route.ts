import { NextResponse } from "next/server";
import { loadHomeCards } from "@/lib/scout";
import { runScoutAgent, scoutBriefing } from "@/lib/club/scout-agent";
import { EMPTY_CLUB, type ClubState, type ScoutAgentId } from "@/lib/club/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      agentId?: ScoutAgentId;
      club?: ClubState;
      limit?: number;
    };
    const agentId = body.agentId || "poacher";
    const club: ClubState = body.club
      ? { ...EMPTY_CLUB, ...body.club, slots: body.club.slots ?? {}, feed: body.club.feed ?? [] }
      : { ...EMPTY_CLUB, slots: {}, feed: [] };

    const catalog = await loadHomeCards(24);
    const picks = runScoutAgent(agentId, catalog, club, body.limit ?? 5);

    return NextResponse.json({
      ok: true,
      briefing: scoutBriefing(agentId, picks),
      picks: picks.map((p) => ({
        login: p.card.login,
        name: p.card.name,
        overall: p.card.overall,
        position: p.card.position,
        family: p.card.family,
        finish: p.card.finish,
        finishLabel: p.card.finishLabel,
        archetype: p.card.archetype,
        avatarUrl: p.card.avatarUrl,
        slotId: p.slotId,
        reason: p.reason,
        card: p.card,
      })),
      catalogSize: catalog.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "Scout run failed" },
      { status: 500 },
    );
  }
}
