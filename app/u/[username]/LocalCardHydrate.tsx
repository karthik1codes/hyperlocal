"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ScoutRoute from "./ScoutRoute";
import { readCardCache, writeCardCache } from "@/hooks/useScout";
import type { Card } from "@/lib/scoring/types";

/**
 * When Redis/memory miss on Vercel, recover the card the lab just wrote to
 * localStorage and re-persist it server-side so publish/bet still works.
 */
export default function LocalCardHydrate({ login }: { login: string }) {
  const [card, setCard] = useState<Card | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const id = login.trim().replace(/^@/, "").toLowerCase();
    const cached = readCardCache(id);
    if (cached?.market) {
      writeCardCache(cached);
      setCard(cached);
      void fetch("/api/local/persist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card: cached }),
      }).catch(() => {
        /* best-effort */
      });
    }
    setReady(true);
  }, [login]);

  if (!ready) {
    return (
      <main className="relative z-[2] mx-auto flex min-h-screen max-w-[560px] flex-col items-center justify-center px-6 text-center">
        <div className="font-display text-[12px] font-bold tracking-[.3em] text-brand">
          SCOUT REPORT
        </div>
        <p className="mt-4 text-[15px] text-ink-soft">Opening your hyper-local card…</p>
      </main>
    );
  }

  if (card) {
    return <ScoutRoute card={card} canonicalCountry={card.country || ""} />;
  }

  return (
    <main className="relative z-[2] mx-auto flex min-h-screen max-w-[560px] flex-col items-center justify-center px-6 text-center">
      <div className="font-display text-[12px] font-bold tracking-[.3em] text-brand">
        SCOUT REPORT
      </div>
      <h1 className="font-display mt-3 text-[clamp(30px,6vw,48px)] font-black leading-[.95]">
        Card not saved
      </h1>
      <p className="mt-3 text-[15.5px] leading-[1.5] text-ink-soft">
        This hyper-local prediction wasn&apos;t stored on the server (common on Vercel without{" "}
        <span className="font-mono text-[13px]">REDIS_URL</span>). Mint it again from the lab —
        then use <span className="text-ink">Create &amp; bet</span> on the card to open a live
        Bento market and place credits.
      </p>
      <Link
        href="/local"
        className="font-display mt-7 inline-flex h-[46px] items-center rounded-xl bg-brand px-6 text-[16px] tracking-[.06em] text-[#04130a] transition hover:bg-brand-hi"
      >
        BACK TO HYPER-LOCAL LAB
      </Link>
    </main>
  );
}
