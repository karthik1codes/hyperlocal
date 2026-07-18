import "server-only";
import { cache } from "react";
import { redis } from "./redis";
import { fetchMarket, type ScoutError } from "./bento/scout-bridge";
import { SAMPLE_CARDS } from "./bento/samples";
import { hasBentoCredentials } from "./bento/config";
import type { Card } from "./scoring/types";

// Re-export error type so routes keep importing from scout / github shim.
export type { ScoutError } from "./bento/scout-bridge";

const CACHE_VERSION = "v2-bento";
const CARD_TTL_SECONDS = 30 * 60; // markets move faster than static profiles

const normalizeLogin = (username: string) => username.trim().replace(/^@/, "").toLowerCase();
const keyFor = (login: string) => `bento:card:${CACHE_VERSION}:${login}`;

async function readCache(login: string): Promise<Card | null> {
  if (!redis) return null;
  try {
    const raw = await redis.get(keyFor(login));
    return raw ? (JSON.parse(raw) as Card) : null;
  } catch (e) {
    console.error("[scout] cache read failed:", (e as Error).message);
    return null;
  }
}

async function writeCache(login: string, card: Card): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(keyFor(login), JSON.stringify(card), "EX", CARD_TTL_SECONDS);
  } catch (e) {
    console.error("[scout] cache write failed:", (e as Error).message);
  }
}

const inflight = new Map<string, Promise<Card>>();

async function buildFresh(username: string, login: string): Promise<Card> {
  const card = await fetchMarket(username);
  await writeCache(login, card);
  return card;
}

export async function scoutCard(username: string): Promise<Card> {
  const login = normalizeLogin(username);

  // Hyper-local research cards (Anakin crawl → stored prediction)
  if (login.startsWith("local-")) {
    const { loadLocalPrediction } = await import("./local/store");
    const row = await loadLocalPrediction(login);
    if (row?.card) return row.card;
    const err: ScoutError = {
      type: "notfound",
      message:
        "This hyper-local card expired or was never saved. Create a new one from the home page.",
    };
    throw err;
  }

  // Demo / no-key: serve baked Bento sample markets by id.
  if (!hasBentoCredentials()) {
    const sample = SAMPLE_CARDS.find((c) => c.login.toLowerCase() === login);
    if (sample) return sample;
  } else {
    // Even with credentials, demo-* ids stay local so the fan always works.
    const sample = SAMPLE_CARDS.find((c) => c.login.toLowerCase() === login);
    if (sample && login.startsWith("demo-")) return sample;
  }

  const cached = await readCache(login);
  if (cached) return cached;

  const existing = inflight.get(login);
  if (existing) return existing;

  const pending = buildFresh(username, login).finally(() => inflight.delete(login));
  inflight.set(login, pending);
  return pending;
}

export const loadCard = cache(
  async (username: string): Promise<{ card: Card } | { error: ScoutError }> => {
    try {
      return { card: await scoutCard(username) };
    } catch (e) {
      return { error: e as ScoutError };
    }
  },
);

/**
 * Markets fan: live Bento credits markets (+ props fill), with a hard timeout
 * so /markets never hangs on a slow listDuels.
 */
export async function loadHomeCards(limit = 8): Promise<Card[]> {
  const TIMEOUT_MS = 4_500;
  try {
    const { listMarketCards } = await import("./bento/scout-bridge");
    const cards = await new Promise<Card[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("markets catalog timeout")), TIMEOUT_MS);
      listMarketCards(limit)
        .then((rows) => {
          clearTimeout(timer);
          resolve(rows);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
    if (cards.length) return cards;
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : e && typeof e === "object" && "message" in e
          ? String((e as { message: unknown }).message)
          : String(e);
    console.warn("[scout] markets catalog failed:", msg);
  }
  return SAMPLE_CARDS.slice(0, limit);
}
