import "server-only";
import { buildCard } from "@/lib/scoring/engine";
import { fetchMarket as fetchBentoMarket, listMarkets } from "./client";
import { hasBentoCredentials } from "./config";
import { marketMetaFromDuel, signalsFromDuel } from "./signals";
import {
  fetchFootballCard,
  isPolymarketLogin,
  listPropsAndFuturesCards,
} from "./polymarket";
import type { Card } from "@/lib/scoring/types";

export type { ScoutError } from "./client";

export function hasBentoLive(): boolean {
  return hasBentoCredentials();
}

export async function fetchMarket(duelId: string): Promise<Card> {
  if (isPolymarketLogin(duelId)) {
    return fetchFootballCard(duelId);
  }
  const duel = await fetchBentoMarket(duelId);
  const card = buildCard(signalsFromDuel(duel));
  return { ...card, market: marketMetaFromDuel(duel) };
}

/**
 * Home catalog: bettable Bento credits markets first (placeBet works),
 * then Props + Futures from testnet.bento.fun/markets (scout-only).
 */
export async function listMarketCards(limit = 8): Promise<Card[]> {
  const bentoWant = Math.max(5, Math.ceil(limit * 0.7));
  const propsWant = Math.max(2, limit - bentoWant);

  const [propsFutures, bento] = await Promise.all([
    listPropsAndFuturesCards(propsWant + 2).catch((e) => {
      console.warn("[scout-bridge] props/futures:", (e as Error).message);
      return [] as Card[];
    }),
    listMarkets(bentoWant + 4).catch((e) => {
      console.warn("[scout-bridge] bento listDuels:", (e as Error).message);
      return [] as Awaited<ReturnType<typeof listMarkets>>;
    }),
  ]);

  const bentoCards = bento.map((d) => {
    const card = buildCard(signalsFromDuel(d));
    return { ...card, market: marketMetaFromDuel(d) };
  });

  const out: Card[] = [];
  const used = new Set<string>();

  // Native Bento first — these support estimateBuy → placeBetFromEstimate
  for (const c of bentoCards) {
    if (used.has(c.login)) continue;
    used.add(c.login);
    out.push(c);
    if (out.length >= bentoWant) break;
  }
  for (const c of propsFutures) {
    if (used.has(c.login)) continue;
    used.add(c.login);
    out.push(c);
    if (out.length >= limit) break;
  }
  // Fill remaining slots from either source
  if (out.length < limit) {
    for (const c of [...bentoCards, ...propsFutures]) {
      if (used.has(c.login)) continue;
      used.add(c.login);
      out.push(c);
      if (out.length >= limit) break;
    }
  }
  return out;
}
