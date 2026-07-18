/** Browser store for hyper-local cards you minted + go-live countdowns. */

export const LOCAL_MADE_CHANGED_EVENT = "bento:local-made-changed";

export type LocalMadeCard = {
  /** Original local-* login (stable key for drafts). */
  localLogin: string;
  /** Live duel id once published (may differ from localLogin). */
  duelId: string | null;
  question: string;
  region: string;
  overall: number | null;
  createdAt: number;
  /** Epoch ms when Bento accepts bets; null until Create & bet. */
  opensAt: number | null;
};

const STORAGE_KEY = "bento:local-made-v1";
const MAX_ROWS = 24;

function notify() {
  try {
    window.dispatchEvent(new Event(LOCAL_MADE_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

function readAll(): LocalMadeCard[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const rows = JSON.parse(raw) as LocalMadeCard[];
    if (!Array.isArray(rows)) return [];
    return rows.filter((r) => r && typeof r.localLogin === "string");
  } catch {
    return [];
  }
}

function writeAll(rows: LocalMadeCard[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(0, MAX_ROWS)));
  } catch {
    /* quota */
  }
  notify();
}

export function listLocalMadeCards(): LocalMadeCard[] {
  return readAll().sort((a, b) => b.createdAt - a.createdAt);
}

export function upsertLocalMadeCard(
  partial: Partial<LocalMadeCard> & { localLogin: string; question: string },
): LocalMadeCard {
  const rows = readAll();
  const key = partial.localLogin.toLowerCase();
  const idx = rows.findIndex(
    (r) =>
      r.localLogin.toLowerCase() === key ||
      (partial.duelId && r.duelId === partial.duelId),
  );
  const prev = idx >= 0 ? rows[idx]! : null;
  const next: LocalMadeCard = {
    localLogin: partial.localLogin,
    duelId: partial.duelId ?? prev?.duelId ?? null,
    question: partial.question || prev?.question || partial.localLogin,
    region: partial.region ?? prev?.region ?? "",
    overall: partial.overall ?? prev?.overall ?? null,
    createdAt: prev?.createdAt ?? partial.createdAt ?? Date.now(),
    opensAt:
      partial.opensAt !== undefined ? partial.opensAt : (prev?.opensAt ?? null),
  };
  if (idx >= 0) rows[idx] = next;
  else rows.unshift(next);
  writeAll(rows);
  return next;
}

export function markLocalCardWarming(input: {
  localLogin: string;
  duelId: string;
  question: string;
  opensAt: number;
  region?: string;
  overall?: number | null;
}): LocalMadeCard {
  return upsertLocalMadeCard({
    localLogin: input.localLogin.startsWith("local-")
      ? input.localLogin
      : input.localLogin,
    duelId: input.duelId,
    question: input.question,
    opensAt: input.opensAt,
    region: input.region,
    overall: input.overall ?? null,
  });
}

export function formatCountdown(opensAt: number, now = Date.now()): string {
  const ms = opensAt - now;
  if (ms <= 0) return "Live now";
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}h ${rm}m`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function cardHref(row: LocalMadeCard): string {
  // Always open the hyper-local slug. After Create & bet we store a private
  // Bento duelId — public /{duelId} lookup returns "No market found" without
  // the creator address. The local-* card already has market.duelId for betting.
  if (row.localLogin.toLowerCase().startsWith("local-")) {
    return `/${encodeURIComponent(row.localLogin)}`;
  }
  const id = row.duelId || row.localLogin;
  return `/${encodeURIComponent(id)}`;
}
