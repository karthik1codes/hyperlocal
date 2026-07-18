"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import Background from "@/components/Background";
import PlayerCard from "@/components/PlayerCard";
import GeminiCard, { hasGeminiCardArt } from "@/components/GeminiCard";
import { useClub } from "@/hooks/useClub";
import {
  FORMATION,
  SCOUT_AGENTS,
  type ScoutAgentId,
  type SlotId,
} from "@/lib/club/types";
import { chemistryScore, isInSquad, squadList, squadOverall } from "@/lib/club/squad";
import type { Card } from "@/lib/scoring/types";
import { cardAvatarSrc } from "@/lib/media/avatarSrc";

type ScoutPickRow = {
  login: string;
  reason: string;
  slotId: SlotId;
  card: Card;
};

export default function ClubView() {
  const { club, ready, setClubName, setAgent, sign, release, clearSquad } = useClub();
  const [picks, setPicks] = useState<ScoutPickRow[]>([]);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [scouting, setScouting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ovr = squadOverall(club);
  const chem = chemistryScore(club);
  const filled = squadList(club).length;

  const runScout = useCallback(async () => {
    setScouting(true);
    setError(null);
    try {
      const res = await fetch("/api/club/scout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: club.agentId, club, limit: 5 }),
      });
      const data = (await res.json()) as {
        error?: string;
        briefing?: string;
        picks?: ScoutPickRow[];
      };
      if (!res.ok) throw new Error(data.error || "Scout failed");
      setBriefing(data.briefing ?? null);
      setPicks(data.picks ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scout failed");
      setPicks([]);
    } finally {
      setScouting(false);
    }
  }, [club]);

  if (!ready) {
    return (
      <div className="relative min-h-screen text-ink">
        <Background />
        <main className="relative z-[2] flex min-h-screen items-center justify-center">
          <p className="font-display text-[18px] tracking-wide text-ink-soft">Loading club…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden text-ink">
      <Background />
      <main className="relative z-[2] mx-auto w-full max-w-[1180px] px-[clamp(18px,4vw,40px)] pb-16 pt-[clamp(18px,3vh,28px)]">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link
              href="/"
              className="text-[12.5px] font-semibold text-ink-soft underline-offset-2 transition hover:text-brand hover:underline"
            >
              ← back to scout
            </Link>
            <h1 className="font-display mt-2 text-[clamp(40px,6vw,72px)] leading-[.85] tracking-[.01em]">
              ULTIMATE <span className="text-brand">CLUB</span>
            </h1>
            <p className="mt-2 max-w-[520px] text-[14px] leading-snug text-ink-soft">
              Build an XI from market cards. Scout signings, then open the Debate floor —
              Bull, Bear, and Risk argue; the Judge explains the call.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/club/debate"
              className="font-display rounded-lg border border-brand/40 bg-brand/15 px-3 py-1.5 text-[12px] tracking-[.14em] text-brand-hi transition hover:bg-brand/25"
            >
              DEBATE →
            </Link>
            <div className="rounded-xl border border-line bg-white/[0.03] px-4 py-3 text-right">
              <div className="font-display text-[11px] tracking-[.2em] text-ink-faint">CLUB OVR</div>
              <div className="font-display text-[42px] leading-none text-brand">{ovr || "—"}</div>
              <div className="mt-1 text-[12px] text-ink-soft">
                {filled}/{FORMATION.length} signed · chem {chem.score}/{chem.max || "—"}
              </div>
            </div>
          </div>
        </header>

        <div className="mb-6 flex flex-wrap items-end gap-3">
          <label className="block min-w-[200px] flex-1">
            <span className="font-display text-[11px] tracking-[.18em] text-ink-faint">CLUB NAME</span>
            <input
              value={club.clubName}
              onChange={(e) => setClubName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-bg/80 px-3 py-2 font-display text-[20px] tracking-wide text-ink outline-none focus:border-brand"
            />
          </label>
          <button
            type="button"
            onClick={clearSquad}
            className="rounded-lg border border-line px-3 py-2 text-[12px] text-ink-soft transition hover:border-brand/40 hover:text-brand"
          >
            Clear squad
          </button>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-2xl border border-line bg-gradient-to-b from-brand/[0.07] to-white/[0.02] p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-[14px] tracking-[.2em] text-brand">4-3-3 PITCH</h2>
              <span className="text-[11px] text-ink-faint">tap a filled slot to release</span>
            </div>
            <div
              className="relative mx-auto grid max-w-[520px] gap-2"
              style={{
                gridTemplateRows: "repeat(6, minmax(72px, auto))",
                gridTemplateColumns: "repeat(4, 1fr)",
              }}
            >
              {FORMATION.map((slot) => {
                const card = club.slots[slot.id];
                return (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => card && release(slot.id)}
                    title={card ? `Release ${card.name}` : slot.label}
                    className="rounded-xl border border-dashed border-white/15 bg-bg/50 p-1.5 text-left transition hover:border-brand/40"
                    style={{ gridRow: slot.row, gridColumn: slot.col }}
                  >
                    <div className="font-display text-[10px] tracking-[.16em] text-ink-faint">
                      {slot.label}
                    </div>
                    {card ? (
                      <div className="mt-1 flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={cardAvatarSrc(card.avatarUrl) || card.avatarUrl}
                          alt=""
                          className="h-9 w-9 rounded-full object-cover"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-semibold text-ink">
                            {card.name}
                          </div>
                          <div className="font-mono text-[11px] text-brand">{card.overall}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 text-[11px] text-ink-mute">empty</div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <div className="rounded-2xl border border-line bg-white/[0.03] p-4">
              <h2 className="font-display text-[14px] tracking-[.2em] text-gold-hi">SCOUT AGENT</h2>
              <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">
                Agents rank live market cards for empty slots. Sign with one click — no on-chain
                order yet.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {SCOUT_AGENTS.map((a) => {
                  const active = club.agentId === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setAgent(a.id as ScoutAgentId)}
                      className={`rounded-xl border px-3 py-2.5 text-left transition ${
                        active
                          ? "border-brand bg-brand/15 text-brand-hi"
                          : "border-line bg-bg/40 text-ink-soft hover:border-brand/40"
                      }`}
                    >
                      <div className="font-display text-[13px] tracking-wide">{a.name}</div>
                      <div className="mt-0.5 text-[11px] opacity-80">{a.role}</div>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-[12px] text-ink-faint">
                {SCOUT_AGENTS.find((a) => a.id === club.agentId)?.blurb}
              </p>
              <button
                type="button"
                disabled={scouting}
                onClick={runScout}
                className="font-display mt-4 h-11 w-full rounded-lg bg-brand text-[15px] tracking-wide text-[#04130a] hover:bg-brand-hi disabled:opacity-60"
              >
                {scouting ? "SCOUTING…" : "RUN SCOUT"}
              </button>
              {briefing && <p className="mt-3 text-[13px] text-ink-soft">{briefing}</p>}
              {error && <p className="mt-2 text-[13px] text-gold-hi">{error}</p>}
            </div>

            <div className="rounded-2xl border border-brand/25 bg-brand/[0.06] p-4">
              <h2 className="font-display text-[14px] tracking-[.2em] text-brand">
                PREDICTION DEBATE
              </h2>
              <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">
                Bull, Bear, and Risk desks argue a market from Bento tape + card stats + your
                club book. The Judge returns a pick and why the call is more accurate.
              </p>
              <Link
                href="/club/debate"
                className="font-display mt-4 flex h-11 w-full items-center justify-center rounded-lg bg-brand text-[15px] tracking-wide text-[#04130a] transition hover:bg-brand-hi"
              >
                OPEN DEBATE FLOOR →
              </Link>
            </div>

            {picks.length > 0 && (
              <div className="rounded-2xl border border-line bg-white/[0.03] p-4">
                <h3 className="font-display text-[12px] tracking-[.18em] text-brand">SHORTLIST</h3>
                <ul className="mt-3 space-y-3">
                  {picks.map((p) => {
                    const already = isInSquad(club, p.login);
                    return (
                      <li
                        key={p.login}
                        className="flex items-start gap-3 rounded-xl border border-line/80 bg-bg/40 p-2.5"
                      >
                        <div className="w-[72px] shrink-0">
                          {hasGeminiCardArt(p.card) ? (
                            <GeminiCard card={p.card} />
                          ) : (
                            <PlayerCard card={p.card} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-ink">{p.card.name}</div>
                          <div className="text-[11px] text-ink-faint">
                            {p.card.position} · {p.card.overall} · → {p.slotId.toUpperCase()}
                          </div>
                          <p className="mt-1 text-[11.5px] leading-snug text-ink-soft">{p.reason}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={already}
                              onClick={() => sign(p.card, p.slotId)}
                              className="rounded-md bg-brand/90 px-2.5 py-1 text-[11px] font-semibold text-[#04130a] disabled:opacity-50"
                            >
                              {already ? "Signed" : "Sign"}
                            </button>
                            <Link
                              href={`/club/debate?login=${encodeURIComponent(p.login)}`}
                              className="rounded-md border border-brand/40 px-2.5 py-1 text-[11px] text-brand-hi hover:bg-brand/10"
                            >
                              Debate
                            </Link>
                            <Link
                              href={`/${encodeURIComponent(p.login)}`}
                              className="rounded-md border border-line px-2.5 py-1 text-[11px] text-ink-soft hover:border-brand/40 hover:text-brand"
                            >
                              Open card
                            </Link>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {club.feed.length > 0 && (
              <div className="rounded-2xl border border-line bg-white/[0.03] p-4">
                <h3 className="font-display text-[12px] tracking-[.18em] text-ink-faint">CLUB FEED</h3>
                <ul className="mt-2 space-y-1.5">
                  {club.feed.slice(0, 8).map((f, i) => (
                    <li key={`${f.at}-${i}`} className="text-[12px] text-ink-soft">
                      <span className="text-ink-mute">
                        {new Date(f.at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>{" "}
                      {f.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>

      </main>
    </div>
  );
}
