/** Browser + in-app “market went live” alerts. */

const NOTIFIED_KEY = "bento:live-notified";

function readNotified(): Set<string> {
  try {
    const raw = sessionStorage.getItem(NOTIFIED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function markNotified(id: string) {
  try {
    const set = readNotified();
    set.add(id);
    sessionStorage.setItem(NOTIFIED_KEY, JSON.stringify([...set].slice(-40)));
  } catch {
    /* ignore */
  }
}

export function wasLiveNotified(id: string): boolean {
  return readNotified().has(id);
}

/** Ask for Notification permission once (safe to call often). */
export async function ensureNotifyPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    const result = await Notification.requestPermission();
    return result === "granted";
  } catch {
    return false;
  }
}

export type LiveNotifyInput = {
  /** Stable id so we only fire once per market open. */
  id: string;
  title?: string;
  body?: string;
  /** Absolute URL or path to open on click. */
  href?: string;
};

/**
 * Fire browser notification immediately when a prediction goes live.
 * Deduped per session by `id`. Returns true if a browser notification was shown.
 */
export function notifyMarketLive(input: LiveNotifyInput): boolean {
  if (typeof window === "undefined") return false;
  if (wasLiveNotified(input.id)) return false;
  markNotified(input.id);

  const title = input.title || "Your market is live";
  const body = input.body || "Betting is open — place your stake now.";

  let shown = false;
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      const n = new Notification(title, {
        body,
        tag: `bento-live-${input.id}`,
      });
      n.onclick = () => {
        try {
          window.focus();
          if (input.href) {
            const path = input.href.startsWith("http")
              ? new URL(input.href).pathname + new URL(input.href).search
              : input.href;
            window.location.assign(path);
          }
        } catch {
          /* ignore */
        }
        n.close();
      };
      shown = true;
    } catch {
      /* ignore */
    }
  }

  // Wake the tab even when permission was denied
  try {
    if (typeof document !== "undefined" && document.hidden) {
      const prev = document.title;
      document.title = "● LIVE — place your bet";
      window.setTimeout(() => {
        if (document.title.startsWith("● LIVE")) document.title = prev;
      }, 8_000);
    }
  } catch {
    /* ignore */
  }

  return shown;
}

export const MARKET_LIVE_EVENT = "bento:market-live";

export function dispatchMarketLive(detail: LiveNotifyInput & { question?: string }) {
  notifyMarketLive(detail);
  try {
    window.dispatchEvent(new CustomEvent(MARKET_LIVE_EVENT, { detail }));
  } catch {
    /* ignore */
  }
}
