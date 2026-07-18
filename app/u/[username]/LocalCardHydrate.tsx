"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ScoutRoute from "./ScoutRoute";
import { readCardCache, writeCardCache } from "@/hooks/useScout";
import { isUsablePhotoAvatar } from "@/lib/media/photoAvatar";
import type { Card } from "@/lib/scoring/types";

function mergePhoto(serverOrNull: Card | null, cached: Card | null): Card | null {
  if (!serverOrNull && !cached) return null;
  if (!serverOrNull) return cached;
  if (!cached) return serverOrNull;
  // Prefer whichever has a real story photo
  if (isUsablePhotoAvatar(serverOrNull.avatarUrl)) return serverOrNull;
  if (isUsablePhotoAvatar(cached.avatarUrl)) {
    return {
      ...serverOrNull,
      avatarUrl: cached.avatarUrl,
      cardImageUrl: cached.cardImageUrl ?? null,
    };
  }
  return serverOrNull;
}

/**
 * When Redis/memory miss on Vercel, recover the card the lab just wrote to
 * localStorage (including the story photo) and re-persist it server-side.
 */
export default function LocalCardHydrate({
  login,
  serverCard = null,
}: {
  login: string;
  /** Optional card from server that may be missing the photo. */
  serverCard?: Card | null;
}) {
  const [card, setCard] = useState<Card | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const id = login.trim().replace(/^@/, "").toLowerCase();
    const cached = readCardCache(id);
    const merged = mergePhoto(serverCard, cached);
    if (merged?.market) {
      writeCardCache(merged);
      setCard(merged);
      void fetch("/api/local/persist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          card: merged,
          hit: {
            title: merged.market.question || merged.name,
            url: merged.market.externalUrl || "",
            sourceHost: "local",
            summary: merged.market.description || "",
            imageUrl: merged.avatarUrl?.startsWith("http") ? merged.avatarUrl : null,
          },
        }),
      }).catch(() => {
        /* best-effort */
      });
    }
    setReady(true);
  }, [login, serverCard]);

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
        href="/"
        className="font-display mt-7 inline-flex h-[46px] items-center rounded-xl bg-brand px-6 text-[16px] tracking-[.06em] text-[#04130a] transition hover:bg-brand-hi"
      >
        BACK TO HYPER-LOCAL LAB
      </Link>
    </main>
  );
}
