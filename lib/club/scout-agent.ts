import type { Card, Finish } from "@/lib/scoring/types";
import {
  FORMATION,
  SCOUT_AGENTS,
  type ClubState,
  type ScoutAgent,
  type ScoutAgentId,
  type SlotId,
} from "./types";
import { findBestSlot, isInSquad } from "./squad";

const FINISH_RANK: Record<Finish, number> = {
  bronze: 1,
  silver: 2,
  gold: 3,
  totw: 4,
  toty: 5,
  icon: 6,
};

function agentById(id: ScoutAgentId): ScoutAgent {
  return SCOUT_AGENTS.find((a) => a.id === id) ?? SCOUT_AGENTS[0];
}

/** Score how badly this agent wants this card (higher = better). */
export function agentDesire(agent: ScoutAgent, card: Card): number {
  let score = card.overall;

  if (agent.families.includes(card.family)) score += 12;
  else score -= 4;

  if (agent.minFinish) {
    const need = FINISH_RANK[agent.minFinish];
    if (FINISH_RANK[card.finish] < need) return -1;
    score += FINISH_RANK[card.finish] * 3;
  }

  if (agent.id === "poacher") {
    score +=
      card.stats.sho * 0.35 +
      (card.report.metrics.find((m) => /volume/i.test(m.label))?.score ?? 0) * 0.15;
    if (card.finish === "totw") score += 8;
  } else if (agent.id === "regista") {
    score += card.stats.pas * 0.3 + card.stats.def * 0.25;
  } else if (agent.id === "mezzala") {
    score += card.stats.pac * 0.25 + card.stats.phy * 0.3;
  } else if (agent.id === "galactico") {
    score += FINISH_RANK[card.finish] * 6 + card.legacy.L * 10;
  }

  return score;
}

export interface ScoutPick {
  card: Card;
  slotId: SlotId;
  reason: string;
  desire: number;
}

export function runScoutAgent(
  agentId: ScoutAgentId,
  catalog: Card[],
  club: ClubState,
  limit = 5,
): ScoutPick[] {
  const agent = agentById(agentId);
  const pool = catalog.filter((c) => !isInSquad(club, c.login));
  const emptyCount = FORMATION.filter((s) => !club.slots[s.id]).length;

  const ranked = pool
    .map((card) => {
      const desire = agentDesire(agent, card);
      const slotId = findBestSlot(club, card);
      return { card, desire, slotId };
    })
    .filter((r) => r.desire >= 0 && r.slotId)
    .sort((a, b) => b.desire - a.desire);

  const usedSlots = new Set<SlotId>();
  const picks: ScoutPick[] = [];

  for (const row of ranked) {
    if (picks.length >= limit) break;
    const slotId = row.slotId!;
    if (usedSlots.has(slotId) && usedSlots.size < emptyCount) continue;
    usedSlots.add(slotId);
    const slot = FORMATION.find((s) => s.id === slotId)!;
    const fit =
      slot.accepts.includes(row.card.position) || slot.preferredFamily === row.card.family
        ? `fits ${slot.label}`
        : `covers ${slot.label}`;
    picks.push({
      card: row.card,
      slotId,
      desire: row.desire,
      reason: `${agent.name}: ${row.card.overall} OVR ${row.card.archetype} — ${fit}`,
    });
  }

  return picks;
}

export function scoutBriefing(agentId: ScoutAgentId, picks: ScoutPick[]): string {
  const agent = agentById(agentId);
  if (!picks.length) {
    return `${agent.name} found no free targets in the current market catalog. Scout more cards or clear a slot.`;
  }
  return `${agent.name} shortlisted ${picks.length} signing${picks.length === 1 ? "" : "s"} for your club.`;
}
