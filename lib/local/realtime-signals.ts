import { buildCard } from "@/lib/scoring/engine";
import { signalsFromBook } from "@/lib/bento/signals";
import type { Card, Signals } from "@/lib/scoring/types";
import type { LocalNewsHit } from "./types";
import type { GeminiCardDraft } from "./openai";

function clampName(s: string, max = 18): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function uniqueTags(parts: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const t = (p || "").trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** Real story tags: category, city, source host, corroborating channel kinds. */
export function tagsFromStory(input: {
  region: string;
  category?: string | null;
  hit: LocalNewsHit;
  extra?: string[];
}): string[] {
  const city = input.region.split(",")[0]?.trim() || "";
  const host = (input.hit.sourceHost || "")
    .replace(/^www\./i, "")
    .split(".")
    .slice(0, -1)
    .join(".") || input.hit.sourceHost;
  const kinds = (input.hit.sources || []).map((s) => s.kind);
  return uniqueTags([input.category || null, city || null, host || null, ...kinds, ...(input.extra || [])]);
}

/**
 * Live signals for a hyper-local card: clocks + story sources + optional book.
 * No hardcoded fillers (no fake "News"/"Hyper-Local" pads, no fixed 1 season).
 */
export function signalsFromLocalRealtime(input: {
  login: string;
  region: string;
  hit: LocalNewsHit;
  draft?: GeminiCardDraft | null;
  /** Epoch ms when the card was minted. */
  createdAtMs: number;
  /** Epoch ms when the prediction resolves (preferred over endsInSeconds). */
  deadlineAtMs?: number | null;
  /** Fallback remaining seconds if deadlineAt unknown. */
  endsInSeconds?: number;
  avatarUrl?: string;
  name?: string;
  /** Live book (from Bento or optimistic stake). */
  volume?: number;
  participants?: number;
  liq0?: number;
  liq1?: number;
  bookTags?: string[];
}): Signals {
  const now = Date.now();
  const createdAtMs = input.createdAtMs > 0 ? input.createdAtMs : now;
  const ageMs = Math.max(0, now - createdAtMs);
  const ageYears = Math.max(ageMs / (365.25 * 86_400_000), 1 / (365.25 * 24)); // ≥ ~1h

  let endsInSeconds = Math.max(0, Number(input.endsInSeconds) || 0);
  if (input.deadlineAtMs && input.deadlineAtMs > 0) {
    endsInSeconds = Math.max(0, Math.floor((input.deadlineAtMs - now) / 1000));
  }
  const daysLeft = Math.max(0, Math.ceil(endsInSeconds / 86_400));
  const daysLive = Math.max(1, Math.floor(ageMs / 86_400_000) || (ageMs > 0 ? 1 : 1));

  const category = input.draft?.category || "Local";
  const name = clampName(input.name || input.draft?.cardName || input.region);
  const tags = tagsFromStory({
    region: input.region,
    category,
    hit: input.hit,
    extra: input.bookTags,
  });
  // Main article + Reddit/X/news corroborations
  const sourceCount = 1 + (input.hit.sources?.length || 0);

  const volume = Math.max(0, Number(input.volume) || 0);
  const participants = Math.max(0, Number(input.participants) || 0);

  if (volume > 0 || participants > 0) {
    return signalsFromBook({
      login: input.login,
      name,
      avatarUrl: input.avatarUrl,
      category,
      tags,
      optionsCount: 2,
      volume,
      participants,
      liq0: input.liq0,
      liq1: input.liq1,
      endsIn: endsInSeconds,
      createdAt: createdAtMs / 1000,
    });
  }

  // Empty book — still real clocks + story structure (volume metrics stay 0)
  return {
    login: input.login,
    name,
    avatarUrl:
      input.avatarUrl ||
      (input.hit.imageUrl?.startsWith("http") ? input.hit.imageUrl : "") ||
      "",
    location: input.region,
    followers: 0,
    account_age_years: ageYears,
    public_repos: sourceCount,
    total_stars_owned: 0,
    max_repo_stars: 0,
    languages: Math.max(1, tags.length),
    rankedLanguages: tags.slice(0, 5),
    topLanguage: category,
    recent_contributions: 0,
    active_days_recent: daysLeft > 0 ? daysLeft : daysLive,
    // Whole years only — 0 hides “Active seasons” for brand-new cards
    active_years: Math.floor(ageYears),
    total_contributions_lifetime: 0,
    prs_to_others: 0,
    reviews: 0,
    issues_closed: 0,
    recent_commits: 0,
    recent_spike: false,
  };
}

/** Deadline epoch from mint time + market endsIn snapshot. */
export function deadlineAtFromCard(card: Card, createdAtMs: number): number {
  const endsIn = Number(card.market?.endsIn || 0);
  if (endsIn > 0) return createdAtMs + endsIn * 1000;
  return createdAtMs + 90 * 86_400_000;
}

/**
 * Rebuild report/stats/overall from clocks (+ book totals already on market).
 * Preserves identity (login, art, question, duelId).
 */
export function recomputeCardRealtime(
  card: Card,
  opts: {
    createdAtMs: number;
    deadlineAtMs?: number | null;
    region?: string;
    hit?: LocalNewsHit;
    draftCategory?: string | null;
  },
): Card {
  const createdAtMs = opts.createdAtMs > 0 ? opts.createdAtMs : Date.now();
  const deadlineAt =
    (opts.deadlineAtMs && opts.deadlineAtMs > 0
      ? opts.deadlineAtMs
      : null) ||
    card.market?.scoutDeadlineAt ||
    deadlineAtFromCard(card, createdAtMs);
  const endsInSeconds = Math.max(0, Math.floor((deadlineAt - Date.now()) / 1000));
  const region = opts.region || card.country || card.market?.category || "Local";
  const hit: LocalNewsHit = opts.hit || {
    title: card.market?.question || card.name,
    url: card.market?.externalUrl || "",
    summary: card.market?.description || "",
    imageUrl: card.avatarUrl?.startsWith("http") ? card.avatarUrl : null,
    sourceHost: null,
    sources: [],
  };

  const rebuilt = buildCard(
    signalsFromLocalRealtime({
      login: card.login,
      region,
      hit,
      draft: opts.draftCategory
        ? ({ category: opts.draftCategory } as GeminiCardDraft)
        : null,
      createdAtMs,
      deadlineAtMs: deadlineAt,
      endsInSeconds,
      avatarUrl: card.avatarUrl,
      name: card.name,
      volume: card.market?.totalBetAmountUsdc ?? 0,
      participants: card.market?.uniqueParticipants ?? 0,
    }),
  );

  return {
    ...rebuilt,
    login: card.login,
    name: card.name,
    avatarUrl: card.avatarUrl,
    cardImageUrl: card.cardImageUrl,
    country: card.country || rebuilt.country,
    topLanguage: card.topLanguage ?? rebuilt.topLanguage,
    languageLogo: card.languageLogo ?? rebuilt.languageLogo,
    archetypeBlurb: card.archetypeBlurb || rebuilt.archetypeBlurb,
    market: card.market
      ? {
          ...card.market,
          endsIn: endsInSeconds,
          scoutMintedAt: card.market.scoutMintedAt || createdAtMs,
          scoutDeadlineAt: deadlineAt,
        }
      : rebuilt.market,
  };
}
