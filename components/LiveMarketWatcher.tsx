"use client";

import { useEffect, useState } from "react";
import {
  LOCAL_MADE_CHANGED_EVENT,
  cardHref,
  listLocalMadeCards,
} from "@/lib/local/made-cards";
import {
  MARKET_LIVE_EVENT,
  dispatchMarketLive,
  ensureNotifyPermission,
  wasLiveNotified,
} from "@/lib/notify-live";

/**
 * Schedules browser + in-app alerts for warming hyper-local markets even if
 * the user leaves the bet panel / refreshes MY BETS.
 */
export default function LiveMarketWatcher() {
  const [toast, setToast] = useState<{ title: string; body: string; href: string } | null>(
    null,
  );

  useEffect(() => {
    void ensureNotifyPermission();

    let timers: number[] = [];

    const clear = () => {
      for (const t of timers) window.clearTimeout(t);
      timers = [];
    };

    const schedule = () => {
      clear();
      const rows = listLocalMadeCards();
      for (const row of rows) {
        if (row.opensAt == null) continue;
        const notifyId = `${row.duelId || row.localLogin}:${row.opensAt}`;
        if (wasLiveNotified(notifyId)) continue;
        const delay = row.opensAt - Date.now();
        if (delay <= 0) {
          dispatchMarketLive({
            id: notifyId,
            title: "Market is live — bet now",
            body: row.question.slice(0, 120),
            href: cardHref(row),
            question: row.question,
          });
          continue;
        }
        timers.push(
          window.setTimeout(() => {
            dispatchMarketLive({
              id: notifyId,
              title: "Market is live — bet now",
              body: row.question.slice(0, 120),
              href: cardHref(row),
              question: row.question,
            });
          }, delay + 50),
        );
      }
    };

    schedule();
    window.addEventListener(LOCAL_MADE_CHANGED_EVENT, schedule);
    const poll = window.setInterval(schedule, 30_000);

    const onLive = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        title?: string;
        body?: string;
        href?: string;
        question?: string;
      };
      setToast({
        title: detail.title || "Market is live — bet now",
        body: detail.body || detail.question || "Betting is open.",
        href: detail.href || "/",
      });
    };
    window.addEventListener(MARKET_LIVE_EVENT, onLive);

    return () => {
      clear();
      window.clearInterval(poll);
      window.removeEventListener(LOCAL_MADE_CHANGED_EVENT, schedule);
      window.removeEventListener(MARKET_LIVE_EVENT, onLive);
    };
  }, []);

  if (!toast) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[max(16px,env(safe-area-inset-bottom))] z-[80] flex justify-center px-4">
      <div className="pointer-events-auto flex w-full max-w-[420px] items-start gap-3 rounded-xl border border-brand/50 bg-bg-deep/95 px-3.5 py-3 shadow-[0_12px_40px_rgba(0,0,0,.45)] backdrop-blur-md">
        <div className="min-w-0 flex-1">
          <p className="font-display text-[11px] font-bold tracking-[.16em] text-brand-hi">
            ● LIVE
          </p>
          <p className="mt-0.5 text-[13px] font-semibold text-ink">{toast.title}</p>
          <p className="mt-0.5 line-clamp-2 text-[12px] text-ink-soft">{toast.body}</p>
          <a
            href={toast.href}
            className="font-display mt-2 inline-flex h-8 items-center rounded-md bg-brand px-3 text-[11px] tracking-wide text-[#04130a] hover:bg-brand-hi"
          >
            OPEN &amp; BET
          </a>
        </div>
        <button
          type="button"
          onClick={() => setToast(null)}
          className="shrink-0 text-[11px] text-ink-faint hover:text-ink"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
