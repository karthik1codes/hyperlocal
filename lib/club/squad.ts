import type { Card } from "@/lib/scoring/types";
import {
  FORMATION,
  type ClubState,
  type FormationSlot,
  type SlotId,
  type SquadCard,
} from "./types";

export function slotDef(id: SlotId): FormationSlot {
  return FORMATION.find((s) => s.id === id)!;
}

export function squadList(state: ClubState): SquadCard[] {
  return FORMATION.map((s) => state.slots[s.id]).filter(Boolean) as SquadCard[];
}

export function squadOverall(state: ClubState): number {
  const cards = squadList(state);
  if (!cards.length) return 0;
  return Math.round(cards.reduce((sum, c) => sum + c.overall, 0) / cards.length);
}

/** Chemistry: +1 when card position/family fits the slot (max = filled slots). */
export function chemistryScore(state: ClubState): { score: number; max: number } {
  let score = 0;
  let max = 0;
  for (const slot of FORMATION) {
    const card = state.slots[slot.id];
    if (!card) continue;
    max += 1;
    const posFit = slot.accepts.includes(card.position);
    const famFit = !slot.preferredFamily || card.family === slot.preferredFamily;
    if (posFit || famFit) score += 1;
  }
  return { score, max };
}

export function isInSquad(state: ClubState, login: string): boolean {
  const key = login.toLowerCase();
  return Object.values(state.slots).some((c) => c?.login.toLowerCase() === key);
}

export function findBestSlot(state: ClubState, card: Card): SlotId | null {
  // Prefer empty slots that accept this position, then preferred family, then any empty.
  const empty = FORMATION.filter((s) => !state.slots[s.id]);
  if (!empty.length) return null;

  const posHit = empty.find((s) => s.accepts.includes(card.position));
  if (posHit) return posHit.id;

  const famHit = empty.find((s) => s.preferredFamily === card.family);
  if (famHit) return famHit.id;

  return empty[0]?.id ?? null;
}

export function addToSquad(state: ClubState, card: Card, slotId?: SlotId): ClubState {
  if (isInSquad(state, card.login)) return state;
  const target = slotId ?? findBestSlot(state, card);
  if (!target) return state;
  return {
    ...state,
    slots: { ...state.slots, [target]: card },
    feed: [
      {
        at: Date.now(),
        text: `Signed ${card.name} (${card.overall} OVR) to ${slotDef(target).label}`,
        login: card.login,
      },
      ...state.feed,
    ].slice(0, 12),
  };
}

export function removeFromSquad(state: ClubState, slotId: SlotId): ClubState {
  const card = state.slots[slotId];
  const next = { ...state.slots };
  delete next[slotId];
  return {
    ...state,
    slots: next,
    feed: card
      ? [
          { at: Date.now(), text: `Released ${card.name} from ${slotDef(slotId).label}`, login: card.login },
          ...state.feed,
        ].slice(0, 12)
      : state.feed,
  };
}

export function assignSlot(state: ClubState, slotId: SlotId, card: Card | null): ClubState {
  if (!card) return removeFromSquad(state, slotId);
  // Drop if already elsewhere
  const cleaned: ClubState["slots"] = {};
  for (const [k, v] of Object.entries(state.slots)) {
    if (v && v.login.toLowerCase() !== card.login.toLowerCase()) {
      cleaned[k as SlotId] = v;
    }
  }
  cleaned[slotId] = card;
  return {
    ...state,
    slots: cleaned,
    feed: [
      {
        at: Date.now(),
        text: `Moved ${card.name} → ${slotDef(slotId).label}`,
        login: card.login,
      },
      ...state.feed,
    ].slice(0, 12),
  };
}
