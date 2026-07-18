"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CLUB_STORAGE_KEY,
  EMPTY_CLUB,
  type ClubState,
  type ScoutAgentId,
  type SlotId,
} from "@/lib/club/types";
import {
  addToSquad,
  assignSlot,
  removeFromSquad,
} from "@/lib/club/squad";
import type { Card } from "@/lib/scoring/types";

function readClub(): ClubState {
  try {
    const raw = localStorage.getItem(CLUB_STORAGE_KEY);
    if (!raw) return { ...EMPTY_CLUB, slots: {}, feed: [] };
    const parsed = JSON.parse(raw) as ClubState;
    if (parsed?.version !== 1) return { ...EMPTY_CLUB, slots: {}, feed: [] };
    return {
      ...EMPTY_CLUB,
      ...parsed,
      slots: parsed.slots ?? {},
      feed: parsed.feed ?? [],
    };
  } catch {
    return { ...EMPTY_CLUB, slots: {}, feed: [] };
  }
}

function writeClub(state: ClubState) {
  try {
    localStorage.setItem(CLUB_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota */
  }
}

export function useClub() {
  const [club, setClub] = useState<ClubState>(() => ({
    ...EMPTY_CLUB,
    slots: {},
    feed: [],
  }));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setClub(readClub());
    setReady(true);
  }, []);

  const persist = useCallback((next: ClubState) => {
    setClub(next);
    writeClub(next);
  }, []);

  const setClubName = useCallback(
    (clubName: string) => persist({ ...club, clubName: clubName.slice(0, 28) }),
    [club, persist],
  );

  const setAgent = useCallback(
    (agentId: ScoutAgentId) => {
      const agentName =
        agentId === "poacher"
          ? "Poacher Scout"
          : agentId === "regista"
            ? "Regista Scout"
            : agentId === "mezzala"
              ? "Mezzala Scout"
              : "Galáctico Scout";
      persist({
        ...club,
        agentId,
        feed: [
          { at: Date.now(), text: `Hired ${agentName} as club scout` },
          ...club.feed,
        ].slice(0, 12),
      });
    },
    [club, persist],
  );

  const sign = useCallback(
    (card: Card, slotId?: SlotId) => persist(addToSquad(club, card, slotId)),
    [club, persist],
  );

  const release = useCallback(
    (slotId: SlotId) => persist(removeFromSquad(club, slotId)),
    [club, persist],
  );

  const move = useCallback(
    (slotId: SlotId, card: Card | null) => persist(assignSlot(club, slotId, card)),
    [club, persist],
  );

  const clearSquad = useCallback(() => {
    persist({
      ...club,
      slots: {},
      feed: [{ at: Date.now(), text: "Cleared the squad" }, ...club.feed].slice(0, 12),
    });
  }, [club, persist]);

  return {
    club,
    ready,
    setClubName,
    setAgent,
    sign,
    release,
    move,
    clearSquad,
    persist,
  };
}
