import type { Card } from "@/lib/scoring/types";
import type { LocalNewsHit } from "./types";

export type StoredLocalPrediction = {
  login: string;
  region: string;
  topic: string;
  question: string;
  hit: LocalNewsHit;
  card: Card;
  createdAt: number;
};

const TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days
const RECENT_LIMIT = 24;
const memKey = (login: string) => `local:pred:${login.toLowerCase()}`;
const RECENT_KEY = "local:pred:recent";

declare global {
  var __bentoLocalPredictions: Map<string, { exp: number; row: StoredLocalPrediction }> | undefined;
  var __bentoLocalRecent: string[] | undefined;
}

function mem(): Map<string, { exp: number; row: StoredLocalPrediction }> {
  if (!globalThis.__bentoLocalPredictions) {
    globalThis.__bentoLocalPredictions = new Map();
  }
  return globalThis.__bentoLocalPredictions;
}

function recentMem(): string[] {
  if (!globalThis.__bentoLocalRecent) {
    globalThis.__bentoLocalRecent = [];
  }
  return globalThis.__bentoLocalRecent;
}

function pushRecentLogin(login: string) {
  const id = login.toLowerCase();
  const list = recentMem().filter((x) => x !== id);
  list.unshift(id);
  globalThis.__bentoLocalRecent = list.slice(0, RECENT_LIMIT);
}

export async function saveLocalPrediction(row: StoredLocalPrediction): Promise<void> {
  const { redis } = await import("@/lib/redis");
  const key = memKey(row.login);
  const payload = JSON.stringify(row);
  mem().set(key, { exp: Date.now() + TTL_SECONDS * 1000, row });
  pushRecentLogin(row.login);

  if (!redis) return;
  try {
    await redis.set(key, payload, "EX", TTL_SECONDS);
    await redis.lrem(RECENT_KEY, 0, row.login.toLowerCase());
    await redis.lpush(RECENT_KEY, row.login.toLowerCase());
    await redis.ltrim(RECENT_KEY, 0, RECENT_LIMIT - 1);
    await redis.expire(RECENT_KEY, TTL_SECONDS);
  } catch (e) {
    console.warn("[local/store] redis write:", (e as Error).message);
  }
}

export async function loadLocalPrediction(loginRaw: string): Promise<StoredLocalPrediction | null> {
  const login = loginRaw.trim().replace(/^@/, "").toLowerCase();
  if (!login.startsWith("local-")) return null;
  const key = memKey(login);

  const { redis } = await import("@/lib/redis");
  if (redis) {
    try {
      const raw = await redis.get(key);
      if (raw) return JSON.parse(raw) as StoredLocalPrediction;
    } catch (e) {
      console.warn("[local/store] redis read:", (e as Error).message);
    }
  }

  const hit = mem().get(key);
  if (!hit) return null;
  if (hit.exp < Date.now()) {
    mem().delete(key);
    return null;
  }
  return hit.row;
}

/** Newest hyper-local prediction cards for the home fan. */
export async function listRecentLocalCards(limit = 8): Promise<Card[]> {
  const n = Math.max(1, Math.min(limit, RECENT_LIMIT));
  const { redis } = await import("@/lib/redis");

  let logins: string[] = [];
  if (redis) {
    try {
      logins = await redis.lrange(RECENT_KEY, 0, n - 1);
    } catch (e) {
      console.warn("[local/store] redis recent:", (e as Error).message);
    }
  }
  if (logins.length === 0) {
    logins = recentMem().slice(0, n);
  }

  const cards: Card[] = [];
  const seen = new Set<string>();
  for (const login of logins) {
    if (seen.has(login)) continue;
    seen.add(login);
    const row = await loadLocalPrediction(login);
    if (row?.card) cards.push(row.card);
    if (cards.length >= n) break;
  }
  return cards;
}

export function isLocalLogin(login: string): boolean {
  return login.trim().toLowerCase().startsWith("local-");
}

function normalizePair(region: string, topic: string): string {
  const r = region
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const t = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return `${r}||${t}`;
}

/**
 * Return an existing hyper-local prediction for the same region+topic
 * (or same source URL) if one was minted recently.
 */
export async function findExistingLocalPrediction(input: {
  region: string;
  topic: string;
  sourceUrl?: string | null;
}): Promise<StoredLocalPrediction | null> {
  const want = normalizePair(input.region, input.topic);
  const wantUrl = input.sourceUrl?.trim().toLowerCase() || null;

  const { redis } = await import("@/lib/redis");
  let logins: string[] = [];
  if (redis) {
    try {
      logins = await redis.lrange(RECENT_KEY, 0, RECENT_LIMIT - 1);
    } catch {
      /* ignore */
    }
  }
  if (logins.length === 0) logins = recentMem().slice(0, RECENT_LIMIT);

  const seen = new Set<string>();
  for (const login of logins) {
    if (seen.has(login)) continue;
    seen.add(login);
    const row = await loadLocalPrediction(login);
    if (!row) continue;
    if (normalizePair(row.region, row.topic) === want) return row;
    if (wantUrl && row.hit.url?.toLowerCase() === wantUrl) return row;
  }

  for (const { row, exp } of mem().values()) {
    if (exp < Date.now()) continue;
    if (normalizePair(row.region, row.topic) === want) return row;
    if (wantUrl && row.hit.url?.toLowerCase() === wantUrl) return row;
  }

  return null;
}
