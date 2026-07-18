"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useBentoWallet } from "@/hooks/useBentoWallet";
import {
  LOCAL_MADE_CHANGED_EVENT,
  cardHref,
  formatCountdown,
  listLocalMadeCards,
  type LocalMadeCard,
} from "@/lib/local/made-cards";

export const BETS_CHANGED_EVENT = "bento:bets-changed";

export type BetRow = {
  duelId: string;
  question: string;
  side: string;
  stake: number | null;
  shares: number | null;
  value: number | null;
  pnl: number | null;
  status: string;
  category: string | null;
};

function fmt(n: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function pnlClass(n: number | null): string {
  if (n == null) return "text-ink-faint";
  if (n > 0) return "text-brand-hi";
  if (n < 0) return "text-red-300";
  return "text-ink-soft";
}

function MadeCardRow({
  row,
  now,
  onClose,
}: {
  row: LocalMadeCard;
  now: number;
  onClose: () => void;
}) {
  const warming = row.opensAt != null && row.opensAt > now;
  const live = row.opensAt != null && row.opensAt <= now;
  const draft = row.opensAt == null;

  return (
    <li>
      <Link
        href={cardHref(row)}
        onClick={onClose}
        className="block rounded-xl border border-line bg-white/[0.03] px-3 py-2.5 transition hover:border-brand/40 hover:bg-brand/[0.06]"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 text-[13px] font-medium leading-snug text-ink">
            {row.question}
          </p>
          {row.overall != null && (
            <span className="font-display shrink-0 text-[14px] tabular-nums text-brand-hi">
              {row.overall}
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          {row.region && <span className="text-ink-faint">{row.region}</span>}
          {draft && (
            <span className="rounded border border-line px-1.5 py-0.5 text-ink-soft">
              Scout card — not live yet
            </span>
          )}
          {warming && (
            <span className="font-mono rounded border border-gold-hi/40 bg-gold-hi/10 px-1.5 py-0.5 text-gold-hi">
              Goes live in {formatCountdown(row.opensAt!, now)}
            </span>
          )}
          {live && (
            <span className="rounded border border-brand/40 bg-brand/10 px-1.5 py-0.5 text-brand-hi">
              Live — ready to bet
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

/** Right-side drawer: cards you made (with go-live countdown) + open bets. */
export default function BetsSidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const wallet = useBentoWallet();
  const { isLoggedIn, token, managedAddress, signingAddress, ensureToken } = wallet;
  const address = managedAddress || signingAddress;

  const [bets, setBets] = useState<BetRow[]>([]);
  const [made, setMade] = useState<LocalMadeCard[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);

  const refreshMade = useCallback(() => {
    setMade(listLocalMadeCards());
  }, []);

  const load = useCallback(async () => {
    refreshMade();
    if (!isLoggedIn || !address) {
      setBets([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const jwt = token || (await ensureToken());
      const res = await fetch("/api/bento/bets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: jwt, address }),
      });
      const data = (await res.json()) as {
        error?: string;
        bets?: BetRow[];
        source?: string;
      };
      if (!res.ok) throw new Error(data.error || "Failed to load bets");
      setBets(data.bets ?? []);
      setSource(data.source ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load bets");
      setBets([]);
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn, address, token, ensureToken, refreshMade]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onRefresh = () => void load();
    window.addEventListener(BETS_CHANGED_EVENT, onRefresh);
    window.addEventListener(LOCAL_MADE_CHANGED_EVENT, onRefresh);
    return () => {
      window.removeEventListener(BETS_CHANGED_EVENT, onRefresh);
      window.removeEventListener(LOCAL_MADE_CHANGED_EVENT, onRefresh);
    };
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Tick countdown while any card is warming up
  useEffect(() => {
    if (!open) return;
    const needsTick = made.some((r) => r.opensAt != null && r.opensAt > Date.now());
    if (!needsTick) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open, made]);

  if (!open) return null;

  const warming = made.filter((r) => r.opensAt != null && r.opensAt > now);
  const drafted = made.filter((r) => r.opensAt == null);
  const liveMade = made.filter((r) => r.opensAt != null && r.opensAt <= now);

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal aria-label="My bets">
      <button
        type="button"
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        aria-label="Close bets sidebar"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-[min(380px,100vw)] flex-col border-l border-brand/25 bg-bg-deep/98 shadow-[-20px_0_60px_rgba(0,0,0,.45)]">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <div className="font-display text-[13px] font-bold tracking-[.2em] text-brand">
              MY BETS
            </div>
            <p className="mt-0.5 text-[11px] text-ink-faint">
              Cards you made + open Bento positions
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-soft transition hover:border-brand/40 hover:text-ink disabled:opacity-50"
            >
              {loading ? "…" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-soft transition hover:border-brand/40 hover:text-ink"
            >
              Close
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {/* Cards you minted */}
          <section className="mb-5">
            <div className="font-display mb-2 px-1 text-[11px] font-bold tracking-[.18em] text-gold-hi">
              CARDS YOU MADE
            </div>
            {made.length === 0 ? (
              <p className="rounded-lg border border-line bg-white/[0.03] px-3 py-3 text-[12.5px] leading-snug text-ink-soft">
                Mint a hyper-local card from home. After you create a live
                prediction, a ~6 min countdown shows here — open the card and
                click BET as soon as it goes live.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {[...warming, ...drafted, ...liveMade].map((row) => (
                  <MadeCardRow
                    key={row.localLogin}
                    row={row}
                    now={now}
                    onClose={onClose}
                  />
                ))}
              </ul>
            )}
          </section>

          {/* Placed bets */}
          <section>
            <div className="font-display mb-2 px-1 text-[11px] font-bold tracking-[.18em] text-brand">
              OPEN POSITIONS
            </div>

            {!isLoggedIn && (
              <p className="rounded-lg border border-line bg-white/[0.03] px-3 py-3 text-[12.5px] leading-snug text-ink-soft">
                Sign in with Bento to see bets you&apos;ve placed.
              </p>
            )}

            {isLoggedIn && loading && bets.length === 0 && (
              <p className="px-1 py-4 text-center text-[13px] text-ink-faint">
                Loading positions…
              </p>
            )}

            {isLoggedIn && error && (
              <p className="mb-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-[12px] leading-snug text-red-200">
                {error}
              </p>
            )}

            {isLoggedIn && !loading && !error && bets.length === 0 && (
              <p className="rounded-lg border border-line bg-white/[0.03] px-3 py-3 text-[12.5px] leading-snug text-ink-soft">
                No open bets yet. Open a live card and place one.
              </p>
            )}

            <ul className="flex flex-col gap-2">
              {bets.map((b) => (
                <li key={`${b.duelId}-${b.side}-${b.status}`}>
                  <Link
                    href={`/${encodeURIComponent(b.duelId)}`}
                    onClick={onClose}
                    className="block rounded-xl border border-line bg-white/[0.03] px-3 py-2.5 transition hover:border-brand/40 hover:bg-brand/[0.06]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-[13px] font-medium leading-snug text-ink">
                        {b.question}
                      </p>
                      <span className="font-display shrink-0 rounded border border-brand/30 bg-brand/10 px-1.5 py-0.5 text-[10px] tracking-wide text-brand-hi">
                        {b.side}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-faint">
                      {b.stake != null && <span>Stake {fmt(b.stake)}</span>}
                      {b.shares != null && <span>Shares {fmt(b.shares)}</span>}
                      {b.value != null && <span>Value {fmt(b.value)}</span>}
                      {b.pnl != null && (
                        <span className={pnlClass(b.pnl)}>
                          PnL {b.pnl > 0 ? "+" : ""}
                          {fmt(b.pnl)}
                        </span>
                      )}
                      <span className="capitalize">{b.status}</span>
                      {b.category && <span>{b.category}</span>}
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-ink-faint">
                      {b.duelId.slice(0, 14)}…
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {source && (
          <footer className="border-t border-line px-4 py-2 text-[10px] text-ink-faint">
            Source · portfolio/{source}
          </footer>
        )}
      </aside>
    </div>
  );
}
