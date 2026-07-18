"use client";

import { useState } from "react";
import type { Card } from "@/lib/scoring/types";

const TTL = 3 * 60 * 60 * 1000;
const cacheKey = (login: string) => `bento:card:${login.toLowerCase()}`;

export function readCardCache(loginRaw: string): Card | null {
  const login = loginRaw.trim().replace(/^@/, "").toLowerCase();
  try {
    const hit = JSON.parse(localStorage.getItem(cacheKey(login)) ?? "null");
    return hit && Date.now() - hit.t < TTL ? (hit.card as Card) : null;
  } catch {
    return null;
  }
}

// Re-persist a card under its login (used when the flag is edited on the report,
// so the chosen country survives a re-scout within the TTL).
export function writeCardCache(card: Card): void {
  try {
    localStorage.setItem(
      cacheKey(card.login),
      JSON.stringify({ t: Date.now(), card }),
    );
  } catch {
    /* quota / private mode — strip huge data URLs and retry once */
    try {
      const slim = {
        ...card,
        avatarUrl:
          card.avatarUrl?.startsWith("data:") && card.avatarUrl.length > 4_000
            ? ""
            : card.avatarUrl,
        cardImageUrl:
          card.cardImageUrl?.startsWith("data:") && card.cardImageUrl.length > 4_000
            ? null
            : card.cardImageUrl,
      };
      localStorage.setItem(
        cacheKey(card.login),
        JSON.stringify({ t: Date.now(), card: slim }),
      );
    } catch {
      /* give up */
    }
  }
}

export function useScout() {
  const [card, setCard] = useState<Card | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scout = async (name: string): Promise<boolean> => {
    if (loading) return false;
    const login = name.trim().replace(/^@/, "");

    const cached = readCardCache(login);
    if (cached) {
      setCard(cached);
      setError(null);
      return true;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/card/${encodeURIComponent(login)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't scout that profile.");
      setCard(data as Card);
      writeCardCache(data as Card);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Edit the current card's flag in place (from the report-page picker) and
  // persist it so a re-scout within the TTL keeps the choice. The cache write is
  // kept out of the setState updater (updaters must stay pure) — `card` is the
  // current value from the render this handler closed over.
  const setCountry = (code: string) => {
    if (!card) return;
    const next = { ...card, country: code };
    setCard(next);
    writeCardCache(next);
  };

  return { card, loading, error, scout, setCountry };
}
