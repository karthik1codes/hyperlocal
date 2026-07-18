import "server-only";
import { researchHyperLocalNews } from "./anakin";
import { cardFromLocalResearch, predictionFromNews, type LocalPredictionBundle } from "./card";
import { findExistingLocalPrediction, saveLocalPrediction } from "./store";
import { canResearchNews } from "./config";
import {
  draftCardWithOpenAI,
  hasOpenAICredentials,
  speakLocalProblemWithOpenAI,
  summarizeLocalProblemForCrawl,
} from "./openai";
import { emitProgress, type ResearchProgress } from "./progress";
import { cardHasDisplayArt } from "@/lib/media/photoAvatar";
import { hasAnakinCredentials } from "./config";

export type { LocalPredictionBundle };
export type { ResearchProgressEvent, ResearchStepId } from "./progress";

function bundleFromStored(
  row: NonNullable<Awaited<ReturnType<typeof findExistingLocalPrediction>>>,
): LocalPredictionBundle {
  return {
    login: row.login,
    region: row.region,
    topic: row.topic,
    question: row.question,
    hit: row.hit,
    card: row.card,
    sharePath: `/${encodeURIComponent(row.login)}`,
    country: row.card.country || null,
    draft: null,
    audioUrl: null,
    reused: true,
  };
}

/**
 * ChatGPT summarizes the local problem → strong crawl → news research →
 * drafts prediction → score card → FUT plate art (public/cards style) → TTS.
 */
export async function createHyperLocalPrediction(input: {
  region: string;
  topic: string;
  onProgress?: ResearchProgress;
}): Promise<LocalPredictionBundle> {
  if (!canResearchNews()) {
    throw new Error(
      "News research unavailable. Use local Chromium (default) or set ANAKIN_API_KEY with LOCAL_NEWS_BROWSER=anakin.",
    );
  }

  const region = input.region.trim();
  const topic = input.topic.trim();

  emitProgress(input.onProgress, "search", "Checking for existing prediction…");
  const existing = await findExistingLocalPrediction({ region, topic });
  if (existing && cardHasDisplayArt(existing.card)) {
    emitProgress(
      input.onProgress,
      "done",
      "Prediction already exists — reusing card",
      existing.login,
    );
    return bundleFromStored(existing);
  }
  if (existing && !cardHasDisplayArt(existing.card)) {
    emitProgress(
      input.onProgress,
      "card",
      "Old card had no photo — reminting with story image…",
      existing.login,
    );
  }

  let crawlTopic = topic;
  let problemSummary: string | null = null;
  if (hasOpenAICredentials()) {
    emitProgress(input.onProgress, "gemini", "Summarizing local problem…");
    const brief = await summarizeLocalProblemForCrawl({ region, topic });
    if (brief?.crawlQuery) {
      crawlTopic = brief.crawlQuery;
      problemSummary = brief.summary;
      emitProgress(input.onProgress, "gemini", "Strong crawl request ready");
    } else {
      emitProgress(input.onProgress, "gemini", "Using your wording for crawl");
    }
  }

  let hit = await researchHyperLocalNews({
    region,
    topic: crawlTopic,
    onProgress: input.onProgress,
  });

  const byUrl = await findExistingLocalPrediction({
    region,
    topic,
    sourceUrl: hit.url,
  });
  if (byUrl && cardHasDisplayArt(byUrl.card)) {
    emitProgress(
      input.onProgress,
      "done",
      "Same story already rated — reusing card",
      byUrl.login,
    );
    return bundleFromStored(byUrl);
  }

  const topicForDraft = problemSummary
    ? `${topic}\n\nIntent: ${problemSummary}\nCrawl focus: ${crawlTopic}`
    : topic;

  const fallbackQuestion = predictionFromNews({ region, topic, hit });
  let draft = null;

  if (hasOpenAICredentials()) {
    emitProgress(input.onProgress, "gemini", "Drafting prediction card…");
    draft = await draftCardWithOpenAI({
      region,
      topic: topicForDraft,
      hit,
      fallbackQuestion,
    });
    if (draft) {
      emitProgress(input.onProgress, "gemini", "Draft ready — building card");
    } else {
      emitProgress(input.onProgress, "gemini", "Using template card");
    }
  } else {
    emitProgress(input.onProgress, "gemini", "No OPENAI_API_KEY — using template card");
  }

  emitProgress(input.onProgress, "card", "Scoring hyper-local card…");

  // Story photos come from Anakin (images/screenshot scrape) — not OpenAI image gen
  if (!hasAnakinCredentials()) {
    emitProgress(
      input.onProgress,
      "extract",
      "Tip: set ANAKIN_API_KEY so Anakin can pull story photos onto the card",
    );
  }
  const { resolveStoryImage } = await import("./story-image");
  const resolvedImage = await resolveStoryImage({
    region,
    topic: crawlTopic,
    hit,
    onProgress: input.onProgress,
  });
  if (resolvedImage) {
    hit = { ...hit, imageUrl: resolvedImage };
  }

  let bundle = cardFromLocalResearch({
    region,
    topic,
    hit,
    draft,
  });

  const sourceImage =
    hit.imageUrl && hit.imageUrl.startsWith("http") ? hit.imageUrl : null;

  if (sourceImage) {
    emitProgress(input.onProgress, "card", "Pasting Anakin story photo onto card…");
    // Keep http on the card for durable /local-* opens (data: embeds get stripped in Redis).
    // Preview still looks good via /api/img proxy.
    bundle = {
      ...bundle,
      card: {
        ...bundle.card,
        avatarUrl: sourceImage,
        cardImageUrl: null,
      },
      hit: { ...hit, imageUrl: sourceImage },
    };
    emitProgress(input.onProgress, "card", "Story photo on FUT plate");
  } else if (!cardHasDisplayArt(bundle.card)) {
    emitProgress(
      input.onProgress,
      "card",
      "No photo from Anakin — card will use plate without portrait. Check ANAKIN_API_KEY / scrape.",
    );
  }

  let audioUrl: string | null = null;
  if (hasOpenAICredentials()) {
    emitProgress(input.onProgress, "tts", "Narrating briefing…");
    audioUrl = await speakLocalProblemWithOpenAI({
      region: bundle.region,
      topic: bundle.topic,
      question: bundle.question,
      summary: bundle.draft?.summary || problemSummary || bundle.hit.summary,
      whyItMatters: bundle.draft?.whyItMatters,
      overall: bundle.card.overall,
      finishLabel: bundle.card.finishLabel,
    });
    if (audioUrl) {
      emitProgress(input.onProgress, "tts", "Briefing ready");
    } else {
      emitProgress(input.onProgress, "tts", "TTS skipped");
    }
  }

  emitProgress(input.onProgress, "store", "Saving card for share…", bundle.login);
  await saveLocalPrediction({
    login: bundle.login,
    region: bundle.region,
    topic: bundle.topic,
    question: bundle.question,
    hit: bundle.hit,
    card: bundle.card,
    createdAt: Date.now(),
    deadlineAt: bundle.card.market?.scoutDeadlineAt,
  });

  emitProgress(input.onProgress, "done", "Card ready", bundle.sharePath);
  return { ...bundle, audioUrl, reused: false };
}
