import { buildCard } from "@/lib/scoring/engine";
import type { Card, BentoMarketMeta } from "@/lib/scoring/types";
import { countryFromLocation } from "@/lib/geo";
import type { LocalNewsHit } from "./types";
import type { GeminiCardDraft } from "./openai";
import { signalsFromLocalRealtime } from "./realtime-signals";

const AVATAR_FALLBACK =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="#0f1a14"/><text x="160" y="168" text-anchor="middle" fill="#39d353" font-size="42" font-family="sans-serif">LOCAL</text></svg>',
  );

function slugify(s: string, max = 48): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, max) || "story";
}

function clampName(s: string, max = 18): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * Turn a hyper-local news hit into a YES/NO prediction question.
 * Prefer an explicit deadline when the user mentioned one in the topic.
 */
export function predictionFromNews(input: {
  region: string;
  topic: string;
  hit: LocalNewsHit;
}): string {
  const topic = input.topic.trim().replace(/\?+$/, "");
  if (/^will\b/i.test(topic) || /\?$/.test(input.topic.trim())) {
    const q = topic.endsWith("?") ? topic : `${topic}?`;
    return q.slice(0, 200);
  }
  return `Will “${topic}” resolve yes for ${input.region} within 90 days?`.slice(0, 200);
}

export function makeLocalLogin(region: string, topic: string): string {
  const stamp = Date.now().toString(36);
  return `local-${slugify(region, 16)}-${slugify(topic, 20)}-${stamp}`;
}

function marketMetaFromLocal(input: {
  login: string;
  region: string;
  question: string;
  hit: LocalNewsHit;
  topic: string;
  draft?: GeminiCardDraft | null;
}): BentoMarketMeta {
  const days = input.draft?.deadlineDays || 90;
  const summary =
    input.draft?.summary ||
    input.hit.summary ||
    `${input.hit.title}`;
  const why = input.draft?.whyItMatters ? `\nWhy it matters: ${input.draft.whyItMatters}` : "";

  const fallbackYes = input.draft?.optionYes || "Yes — the outcome happens";
  const fallbackNo = input.draft?.optionNo || "No — the outcome fails";
  const optionYes = fallbackYes.slice(0, 80);
  const optionNo = fallbackNo.slice(0, 80);

  return {
    duelId: input.login,
    dbId: input.login,
    duelType: "prediction",
    options: [optionYes, optionNo],
    collateralMode: "credits",
    totalBetAmountUsdc: 0,
    uniqueParticipants: 0,
    status: 1,
    category: input.draft?.category || "Hyper-Local",
    description: `${summary}${why}\n\nSource: ${input.hit.url}\nTopic: ${input.topic}`,
    endsIn: days * 86_400,
    question: input.question,
    source: "local",
    conditionId: null,
    marketMakerAddress: null,
    slug: input.login,
    externalUrl: input.hit.url,
    outcomeAddresses: [],
    scoutMintedAt: Date.now(),
    scoutDeadlineAt: Date.now() + days * 86_400_000,
  };
}

export type LocalPredictionBundle = {
  login: string;
  region: string;
  topic: string;
  question: string;
  hit: LocalNewsHit;
  card: Card;
  sharePath: string;
  country: string | null;
  draft?: GeminiCardDraft | null;
  /** Gemini TTS briefing WAV data URL (not persisted). */
  audioUrl?: string | null;
  /** True when an existing region+topic card was returned instead of minting. */
  reused?: boolean;
};

export function cardFromLocalResearch(input: {
  region: string;
  topic: string;
  hit: LocalNewsHit;
  draft?: GeminiCardDraft | null;
  /** Full Gemini FUT plate — becomes the real card image. */
  cardImageUrl?: string | null;
}): LocalPredictionBundle {
  const login = makeLocalLogin(input.region, input.topic);
  const question = (input.draft?.question || predictionFromNews(input)).slice(0, 200);
  const createdAtMs = Date.now();
  const days = input.draft?.deadlineDays || 90;
  const signals = signalsFromLocalRealtime({
    login,
    region: input.region,
    hit: input.hit,
    draft: input.draft,
    createdAtMs,
    deadlineAtMs: createdAtMs + days * 86_400_000,
    endsInSeconds: days * 86_400,
  });
  const card = buildCard(signals);
  const country = countryFromLocation(input.region) || card.country;
  const displayName = clampName(input.draft?.cardName || input.region);
  const withMarket: Card = {
    ...card,
    country,
    name: displayName,
    avatarUrl: signals.avatarUrl || AVATAR_FALLBACK,
    cardImageUrl: input.cardImageUrl || null,
    market: marketMetaFromLocal({
      login,
      region: input.region,
      question,
      hit: input.hit,
      topic: input.topic,
      draft: input.draft,
    }),
  };

  if (input.draft?.whyItMatters) {
    withMarket.archetypeBlurb = input.draft.whyItMatters;
  }

  return {
    login,
    region: input.region,
    topic: input.topic,
    question,
    hit: input.hit,
    card: withMarket,
    sharePath: `/${encodeURIComponent(login)}`,
    country,
    draft: input.draft ?? null,
  };
}
