import { buildCard } from "@/lib/scoring/engine";
import type { Card } from "@/lib/scoring/types";
import { preferMarketDisplayCategory } from "./category";
import { signalsFromBook } from "./signals";

/**
 * Keep hyper-local identity (slug, art, region name) while swapping in live
 * book-driven OVR / attributes / scouting metrics.
 */
export function mergeLiveScoutCard(base: Card, live: Card): Card {
  const keepLocalLogin = base.login.toLowerCase().startsWith("local-");
  const liveStatus = Number(live.market?.status ?? 0);
  const baseStatus = Number(base.market?.status ?? 0);
  // Don't paint a still-warm / previously-open market as cancelled because a
  // public catalog poll returned status=-1 (common for private duels).
  const status =
    liveStatus < 0 && keepLocalLogin
      ? baseStatus >= 0
        ? baseStatus
        : 1
      : liveStatus || baseStatus;

  const category = preferMarketDisplayCategory(
    base.market?.category,
    keepLocalLogin ? "Hyper-Local" : live.market?.category,
    `${base.market?.description || ""}\n${live.market?.description || ""}\n${base.market?.question || ""}\n${live.market?.question || ""}\n${base.name}`,
  );

  return {
    ...live,
    login: keepLocalLogin ? base.login : live.login,
    name: base.name || live.name,
    avatarUrl: base.avatarUrl || live.avatarUrl,
    cardImageUrl: base.cardImageUrl ?? live.cardImageUrl,
    country: base.country || live.country,
    topLanguage: base.topLanguage ?? live.topLanguage,
    languageLogo: base.languageLogo ?? live.languageLogo,
    archetypeBlurb: base.archetypeBlurb || live.archetypeBlurb,
    market: live.market
      ? {
          ...live.market,
          status,
          category,
          source: "bento",
          externalUrl: base.market?.externalUrl ?? live.market.externalUrl,
          question: live.market.question || base.market?.question || "",
          options:
            live.market.options?.length >= 2
              ? live.market.options
              : base.market?.options?.length
                ? base.market.options
                : live.market.options,
          description: live.market.description || base.market?.description || null,
          scoutMintedAt: base.market?.scoutMintedAt ?? live.market.scoutMintedAt,
          scoutDeadlineAt: base.market?.scoutDeadlineAt ?? live.market.scoutDeadlineAt,
          // Prefer longer known runway over a truncated catalog endsIn
          endsIn: Math.max(
            Number(live.market.endsIn) || 0,
            Number(base.market?.endsIn) || 0,
          ),
        }
      : base.market,
  };
}

/** Optimistic metrics bump right after a stake lands (before the catalog refreshes). */
export function applyStakeToCard(card: Card, units: number): Card {
  const market = card.market;
  if (!market || !Number.isFinite(units) || units <= 0) return card;
  if (
    market.duelId.startsWith("local-") ||
    market.duelId.startsWith("demo-") ||
    market.duelId.startsWith("pm-")
  ) {
    return card;
  }

  const volume = Math.max(0, Number(market.totalBetAmountUsdc) || 0) + units;
  const participants = Math.max(1, Number(market.uniqueParticipants) || 0) + 1;
  const rebuilt = buildCard(
    signalsFromBook({
      login: card.login,
      name: market.question || card.name,
      avatarUrl: card.avatarUrl,
      category: market.category || "Markets",
      tags: [],
      optionsCount: market.options?.length ?? 2,
      volume,
      participants,
      liq0: volume / 2,
      liq1: volume / 2,
      endsIn: market.endsIn || 90 * 86_400,
    }),
  );

  return mergeLiveScoutCard(card, {
    ...rebuilt,
    market: {
      ...market,
      source: "bento",
      totalBetAmountUsdc: volume,
      uniqueParticipants: participants,
    },
  });
}

export function isLiveRefreshableDuelId(duelId: string | null | undefined): boolean {
  const id = (duelId || "").trim();
  if (!id) return false;
  if (id.startsWith("local-") || id.startsWith("demo-") || id.startsWith("pm-")) return false;
  return true;
}
