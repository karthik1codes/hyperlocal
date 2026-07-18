import type { Card } from "@/lib/scoring/types";
import type { LocalNewsHit } from "./types";
import { isUsablePhotoAvatar } from "@/lib/media/photoAvatar";
import { preferMarketDisplayCategory, isBentoSportCategory } from "@/lib/bento/category";
import { recomputeCardRealtime } from "./realtime-signals";

export type StoredLocalPrediction = {
  login: string;
  region: string;
  topic: string;
  question: string;
  hit: LocalNewsHit;
  card: Card;
  createdAt: number;
  /** Absolute resolve deadline (ms). When missing, derived from createdAt + endsIn. */
  deadlineAt?: number;
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

function httpImage(url: string | null | undefined): string | null {
  const u = (url || "").trim();
  return u.startsWith("http://") || u.startsWith("https://") ? u : null;
}

/**
 * Ensure the opened card shows the same story photo as the lab preview.
 * Prefer durable http URLs (survives Redis) over large data: embeds.
 */
export function restoreLocalCardPhoto(row: StoredLocalPrediction): Card {
  const card = row.card;
  const fromHit = httpImage(row.hit?.imageUrl);
  if (isUsablePhotoAvatar(card.avatarUrl)) {
    if (fromHit && card.avatarUrl!.startsWith("data:")) {
      return { ...card, avatarUrl: fromHit, cardImageUrl: null };
    }
    return card;
  }
  if (fromHit) return { ...card, avatarUrl: fromHit, cardImageUrl: null };
  return card;
}

/**
 * Home/markets fans must not ship multi‑MB data:image payloads through RSC —
 * that blows the flight payload and surfaces as a production 500.
 */
export function slimCardForFan(card: Card): Card {
  const avatar = (card.avatarUrl || "").trim();
  const plate = (card.cardImageUrl || "").trim();
  const slimAvatar =
    avatar.startsWith("data:") && avatar.length > 6_000
      ? avatar.startsWith("data:image/svg")
        ? avatar
        : ""
      : avatar;
  const slimPlate =
    !plate || (plate.startsWith("data:") && plate.length > 6_000) ? null : plate;
  if (slimAvatar === avatar && slimPlate === (card.cardImageUrl || null)) return card;
  return { ...card, avatarUrl: slimAvatar, cardImageUrl: slimPlate };
}

/** Strip huge data URLs but keep the http story photo on the card + hit. */
export function slimPredictionForStorage(row: StoredLocalPrediction): StoredLocalPrediction {
  const durablePhoto =
    httpImage(row.hit?.imageUrl) || httpImage(row.card.avatarUrl) || null;

  let card = slimCardForFan(row.card);
  // After stripping data: avatars, put the http photo back so /local-* opens with art
  if (durablePhoto) {
    card = { ...card, avatarUrl: durablePhoto, cardImageUrl: null };
  }

  return {
    ...row,
    card,
    hit: {
      ...row.hit,
      summary: (row.hit.summary || "").slice(0, 2_000),
      title: (row.hit.title || "").slice(0, 300),
      imageUrl: durablePhoto,
    },
  };
}

function stampDeadlines(row: StoredLocalPrediction): StoredLocalPrediction {
  const createdAt = row.createdAt > 0 ? row.createdAt : Date.now();
  const deadlineAt =
    row.deadlineAt ||
    row.card.market?.scoutDeadlineAt ||
    createdAt + (Number(row.card.market?.endsIn) || 90 * 86_400) * 1000;
  const market = row.card.market
    ? {
        ...row.card.market,
        scoutMintedAt: row.card.market.scoutMintedAt || createdAt,
        scoutDeadlineAt: row.card.market.scoutDeadlineAt || deadlineAt,
      }
    : row.card.market;
  return {
    ...row,
    createdAt,
    deadlineAt,
    card: market ? { ...row.card, market } : row.card,
  };
}

function withLiveClocks(row: StoredLocalPrediction): StoredLocalPrediction {
  const stamped = stampDeadlines(row);
  let photo = restoreLocalCardPhoto(stamped);
  // Don't leave Politics/Hyper-Local cards stuck as Cricket after createDuel
  if (photo.market && isBentoSportCategory(photo.market.category)) {
    const fixed = preferMarketDisplayCategory(
      null,
      "Hyper-Local",
      `${photo.market.description || ""}\n${photo.market.question || ""}\n${photo.name || ""}`,
    );
    if (fixed !== photo.market.category) {
      photo = { ...photo, market: { ...photo.market, category: fixed } };
    }
  }
  try {
    const card = recomputeCardRealtime(photo, {
      createdAtMs: stamped.createdAt,
      deadlineAtMs: stamped.deadlineAt,
      region: stamped.region,
      hit: stamped.hit,
      draftCategory: photo.market?.category || stamped.card.market?.category || null,
    });
    return { ...stamped, card };
  } catch (e) {
    console.warn("[local/store] recompute clocks:", (e as Error).message);
    return { ...stamped, card: photo };
  }
}

export async function saveLocalPrediction(row: StoredLocalPrediction): Promise<{ redis: boolean }> {
  const slim = slimPredictionForStorage(stampDeadlines(row));
  const { redis } = await import("@/lib/redis");
  const key = memKey(slim.login);
  const payload = JSON.stringify(slim);
  mem().set(key, { exp: Date.now() + TTL_SECONDS * 1000, row: slim });
  pushRecentLogin(slim.login);

  if (!redis) {
    if (process.env.VERCEL) {
      console.warn(
        "[local/store] REDIS_URL missing on Vercel — local cards only live in this function instance until the browser re-persists them.",
      );
    }
    return { redis: false };
  }
  try {
    await redis.set(key, payload, "EX", TTL_SECONDS);
    await redis.lrem(RECENT_KEY, 0, slim.login.toLowerCase());
    await redis.lpush(RECENT_KEY, slim.login.toLowerCase());
    await redis.ltrim(RECENT_KEY, 0, RECENT_LIMIT - 1);
    await redis.expire(RECENT_KEY, TTL_SECONDS);
    return { redis: true };
  } catch (e) {
    console.warn("[local/store] redis write:", (e as Error).message);
    return { redis: false };
  }
}

function parseStoredRow(raw: string): StoredLocalPrediction | null {
  try {
    const row = JSON.parse(raw) as StoredLocalPrediction;
    if (!row?.login || !row?.card?.login) return null;
    return row;
  } catch (e) {
    console.warn("[local/store] corrupt prediction JSON:", (e as Error).message);
    return null;
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
      if (raw) {
        const row = parseStoredRow(raw);
        if (row) {
          return withLiveClocks(row);
        }
      }
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
  return withLiveClocks(hit.row);
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
    try {
      const row = await loadLocalPrediction(login);
      if (row?.card) cards.push(slimCardForFan(restoreLocalCardPhoto(row)));
    } catch (e) {
      console.warn(
        `[local/store] skip ${login}:`,
        e instanceof Error ? e.message : e,
      );
    }
    if (cards.length >= n) break;
  }
  return cards;
}

export function isLocalLogin(login: string): boolean {
  return login.trim().toLowerCase().startsWith("local-");
}

/** Find a saved hyper-local card that was published to this Bento duelId. */
export async function findLocalPredictionByDuelId(
  duelIdRaw: string,
): Promise<StoredLocalPrediction | null> {
  const duelId = duelIdRaw.trim();
  if (!duelId || duelId.startsWith("local-")) return null;

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
    if (row.card.market?.duelId === duelId || row.login === duelId) return row;
  }

  for (const { row, exp } of mem().values()) {
    if (exp < Date.now()) continue;
    if (row.card.market?.duelId === duelId) {
      return { ...row, card: restoreLocalCardPhoto(row) };
    }
  }
  return null;
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
    const restored = { ...row, card: restoreLocalCardPhoto(row) };
    if (normalizePair(row.region, row.topic) === want) return restored;
    if (wantUrl && row.hit.url?.toLowerCase() === wantUrl) return restored;
  }

  return null;
}
