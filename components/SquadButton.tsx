"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Card } from "@/lib/scoring/types";
import { useClub } from "@/hooks/useClub";
import { isInSquad } from "@/lib/club/squad";
import { FORMATION, type SlotId } from "@/lib/club/types";

export default function SquadButton({ card }: { card: Card }) {
  const { club, ready, sign, release } = useClub();
  const [flash, setFlash] = useState<string | null>(null);

  const inSquad = ready && isInSquad(club, card.login);
  const full = ready && Object.keys(club.slots).length >= FORMATION.length;

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(t);
  }, [flash]);

  const onClick = () => {
    if (inSquad) {
      const slot = Object.entries(club.slots).find(
        ([, c]) => c?.login.toLowerCase() === card.login.toLowerCase(),
      )?.[0];
      if (slot) release(slot as SlotId);
      setFlash("Released from club");
      return;
    }
    if (full) {
      setFlash("Squad full — open Club to free a slot");
      return;
    }
    sign(card);
    setFlash("Signed to club");
  };

  return (
    <div className="w-full">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!ready}
          onClick={onClick}
          className="font-display h-10 flex-1 rounded-lg border border-line bg-white/[0.04] text-[13px] tracking-wide text-ink transition hover:border-brand/50 hover:text-brand disabled:opacity-50"
        >
          {!ready ? "…" : inSquad ? "RELEASE" : "ADD TO CLUB"}
        </button>
        <Link
          href="/club"
          className="font-display flex h-10 items-center rounded-lg border border-brand/40 bg-brand/10 px-3 text-[12px] tracking-wide text-brand-hi hover:bg-brand/20"
        >
          CLUB
        </Link>
      </div>
      {flash && <p className="mt-1.5 text-[11px] text-ink-soft">{flash}</p>}
    </div>
  );
}
