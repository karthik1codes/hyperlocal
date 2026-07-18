"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Background from "@/components/Background";
import DebatePanel from "@/components/DebatePanel";
import PlayerCard from "@/components/PlayerCard";
import GeminiCard, { hasGeminiCardArt } from "@/components/GeminiCard";
import { useClub } from "@/hooks/useClub";
import { squadList } from "@/lib/club/squad";
import { DEBATE_AGENTS } from "@/lib/club/debate/types";
import type { DebateResult } from "@/lib/club/debate/types";
import type { Card } from "@/lib/scoring/types";

export default function DebateView() {
  const search = useSearchParams();
  const { club, ready } = useClub();
  const [target, setTarget] = useState("");
  const [debating, setDebating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debate, setDebate] = useState<DebateResult | null>(null);

  const squadCards = useMemo(() => squadList(club), [club]);

  useEffect(() => {
    const q = search.get("login")?.trim() || search.get("duelId")?.trim() || "";
    if (q) setTarget(q);
    else if (!target && squadCards[0]) setTarget(squadCards[0].login);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once from URL / squad
  }, [search, squadCards]);

  const selectedCard: Card | undefined = useMemo(() => {
    return squadCards.find((c) => c.login === target);
  }, [squadCards, target]);

  const runDebate = useCallback(async () => {
    const id = target.trim();
    if (!id) {
      setError("Enter a market login or duelId to debate.");
      return;
    }
    setDebating(true);
    setError(null);
    setDebate(null);
    try {
      const res = await fetch("/api/club/debate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          login: id,
          card: selectedCard,
          club,
        }),
      });
      const data = (await res.json()) as { error?: string; debate?: DebateResult };
      if (!res.ok || !data.debate) throw new Error(data.error || "Debate failed");
      setDebate(data.debate);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Debate failed");
    } finally {
      setDebating(false);
    }
  }, [club, selectedCard, target]);

  if (!ready) {
    return (
      <div className="relative min-h-screen text-ink">
        <Background />
        <main className="relative z-[2] flex min-h-screen items-center justify-center">
          <p className="font-display text-[18px] tracking-wide text-ink-soft">Loading…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden text-ink">
      <Background />
      <main className="relative z-[2] mx-auto w-full max-w-[1100px] px-[clamp(18px,4vw,40px)] pb-16 pt-[clamp(18px,3vh,28px)]">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3 text-[12.5px] font-semibold">
              <Link
                href="/club"
                className="text-ink-soft underline-offset-2 transition hover:text-brand hover:underline"
              >
                ← Ultimate Club
              </Link>
              <span className="text-ink-mute">/</span>
              <span className="text-brand">Debate</span>
            </div>
            <h1 className="font-display mt-2 text-[clamp(40px,6vw,76px)] leading-[.86] tracking-[.01em]">
              AGENT <span className="text-brand">DEBATE</span>
            </h1>
            <p className="mt-2 max-w-[540px] text-[14px] leading-snug text-ink-soft">
              Bull, Bear, and Risk desks argue a market from Bento tape + card stats + your
              club book. The Judge returns a pick and why the call is more accurate.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/"
              className="font-display rounded-lg border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] tracking-[.12em] text-ink-soft transition hover:border-brand/40 hover:text-ink"
            >
              HOME
            </Link>
            <Link
              href="/markets"
              className="font-display rounded-lg border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] tracking-[.12em] text-ink-soft transition hover:border-brand/40 hover:text-ink"
            >
              MARKETS
            </Link>
            <Link
              href="/club"
              className="font-display rounded-lg border border-brand/35 bg-brand/10 px-3 py-1.5 text-[12px] tracking-[.12em] text-brand-hi transition hover:bg-brand/20"
            >
              CLUB
            </Link>
          </div>
        </header>

        <div className="mb-6 grid gap-3 sm:grid-cols-4">
          {DEBATE_AGENTS.map((a) => (
            <div
              key={a.id}
              className="rounded-xl border border-line bg-white/[0.03] px-3 py-2.5"
            >
              <div className="font-display text-[12px] tracking-[.14em] text-gold-hi">
                {a.name.toUpperCase()}
              </div>
              <p className="mt-1 text-[11.5px] leading-snug text-ink-faint">{a.role}</p>
            </div>
          ))}
        </div>

        <section className="rounded-2xl border border-brand/25 bg-white/[0.03] p-4 sm:p-5">
          <div className="font-display text-[11px] tracking-[.2em] text-brand">
            CHOOSE A MARKET
          </div>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1">
              <span className="font-display text-[10px] tracking-[.16em] text-ink-faint">
                FROM YOUR SQUAD
              </span>
              <select
                value={squadCards.some((c) => c.login === target) ? target : ""}
                onChange={(e) => setTarget(e.target.value)}
                className="mt-1 w-full rounded-xl border border-line bg-bg/80 px-3 py-2.5 text-[14px] text-ink outline-none focus:border-brand"
              >
                <option value="">Select a signed card…</option>
                {squadCards.map((c) => (
                  <option key={c.login} value={c.login}>
                    {c.name} · {c.overall} {c.position}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 flex-[1.2]">
              <span className="font-display text-[10px] tracking-[.16em] text-ink-faint">
                OR PASTE LOGIN / DUEL ID
              </span>
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="e.g. local-bengaluru-… or a Bento duelId"
                className="font-mono mt-1 w-full rounded-xl border border-line bg-bg/80 px-3 py-2.5 text-[13px] text-ink outline-none focus:border-brand"
              />
            </label>
            <button
              type="button"
              disabled={debating || !target.trim()}
              onClick={() => void runDebate()}
              className="font-display h-[46px] shrink-0 rounded-xl bg-brand px-6 text-[14px] tracking-wide text-[#04130a] transition hover:bg-brand-hi disabled:cursor-not-allowed disabled:opacity-55"
            >
              {debating ? "DEBATING…" : "START DEBATE"}
            </button>
          </div>

          {!squadCards.length && (
            <p className="mt-3 text-[12px] text-ink-faint">
              No squad cards yet —{" "}
              <Link href="/club" className="text-brand underline-offset-2 hover:underline">
                open Club
              </Link>{" "}
              to scout & sign, or paste any live market id above.
            </p>
          )}

          {error && (
            <p className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-200">
              {error}
            </p>
          )}
        </section>

        {selectedCard && (
          <div className="mt-6 flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-white/[0.02] p-3">
            <div className="w-[100px] shrink-0">
              {hasGeminiCardArt(selectedCard) ? (
                <GeminiCard card={selectedCard} />
              ) : (
                <PlayerCard card={selectedCard} />
              )}
            </div>
            <div className="min-w-0">
              <div className="font-display text-[18px] text-ink">{selectedCard.name}</div>
              <p className="text-[12px] text-ink-faint">
                {selectedCard.overall} {selectedCard.position} · {selectedCard.finishLabel}
              </p>
              {selectedCard.market?.question && (
                <p className="mt-1 max-w-[480px] text-[13px] leading-snug text-ink-soft">
                  {selectedCard.market.question}
                </p>
              )}
              <Link
                href={`/${encodeURIComponent(selectedCard.login)}`}
                className="mt-2 inline-block text-[12px] text-brand underline-offset-2 hover:underline"
              >
                Open card →
              </Link>
            </div>
          </div>
        )}

        {debating && (
          <div className="mt-8 rounded-2xl border border-brand/20 bg-[#06140c]/80 px-4 py-6 text-center">
            <p className="font-display text-[13px] tracking-[.18em] text-brand">
              DESKS ARE LIVE
            </p>
            <p className="mt-2 text-[14px] text-ink-soft">
              Gathering evidence · Bull / Bear / Risk arguing · Judge weighing…
            </p>
          </div>
        )}

        {debate && (
          <div className="mt-8">
            <DebatePanel debate={debate} onClose={() => setDebate(null)} />
          </div>
        )}
      </main>
    </div>
  );
}
