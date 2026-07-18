import "server-only";
import { researchHyperLocalNews } from "./anakin";
import { cardFromLocalResearch, predictionFromNews, type LocalPredictionBundle } from "./card";
import { findExistingLocalPrediction, saveLocalPrediction } from "./store";
import { canResearchNews } from "./config";
import {
  draftCardWithOpenAI,
  generateCardImageWithOpenAI,
  generateScenePortraitWithOpenAI,
  hasOpenAICredentials,
  speakLocalProblemWithOpenAI,
  summarizeLocalProblemForCrawl,
} from "./openai";
import { emitProgress, type ResearchProgress } from "./progress";
import { embedRemoteImageAsDataUrl } from "@/lib/media/embedImage";
import { cardHasDisplayArt } from "@/lib/media/photoAvatar";

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

  // Resolve a problem-related photo (Anakin / OG / Wikipedia) before scoring art
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

  // Always keep the crawled source photo on the card when present
  let sourceImage =
    hit.imageUrl && hit.imageUrl.startsWith("http") ? hit.imageUrl : null;

  // If crawl found nothing, paint a scene portrait so the plate isn't "LOCAL"
  if (!sourceImage && hasOpenAICredentials()) {
    emitProgress(input.onProgress, "gemini", "Generating story scene photo…");
    const painted = await generateScenePortraitWithOpenAI({
      region,
      topic,
      hit,
      draft,
    });
    if (painted) {
      sourceImage = painted;
      hit = { ...hit, imageUrl: painted.startsWith("http") ? painted : hit.imageUrl };
      bundle = {
        ...bundle,
        card: {
          ...bundle.card,
          avatarUrl: painted,
          cardImageUrl: null,
        },
        hit,
      };
      emitProgress(input.onProgress, "card", "Story scene ready for plate");
    }
  }

  if (sourceImage && !sourceImage.startsWith("data:")) {
    emitProgress(input.onProgress, "card", "Pasting story photo onto card…");
    const embedded = await embedRemoteImageAsDataUrl(sourceImage);
    const avatarUrl =
      embedded && embedded.length <= 120_000 ? embedded : sourceImage;
    bundle = {
      ...bundle,
      card: {
        ...bundle.card,
        avatarUrl,
        cardImageUrl: null,
      },
      hit,
    };
  } else if (sourceImage?.startsWith("data:")) {
    bundle = {
      ...bundle,
      card: {
        ...bundle.card,
        avatarUrl: sourceImage,
        cardImageUrl: null,
      },
      hit,
    };
  }

  // Full AI plate only when we still have no usable portrait
  if (hasOpenAICredentials() && !cardHasDisplayArt(bundle.card)) {
    emitProgress(input.onProgress, "gemini", "Painting FUT card with story scene…");
    const cardImageUrl = await generateCardImageWithOpenAI({
      region,
      topic,
      hit,
      draft,
      card: {
        name: bundle.card.name,
        overall: bundle.card.overall,
        position: bundle.card.position,
        country: bundle.card.country,
        finishLabel: bundle.card.finishLabel,
        stats: bundle.card.stats,
      },
    });
    if (cardImageUrl) {
      bundle = {
        ...bundle,
        card: {
          ...bundle.card,
          cardImageUrl,
          // clear LOCAL placeholder so GeminiCard is allowed to render
          avatarUrl: "",
        },
        hit,
      };
      emitProgress(input.onProgress, "gemini", "Card art ready");
    } else {
      emitProgress(input.onProgress, "gemini", "Opening scored card");
    }
  } else if (cardHasDisplayArt(bundle.card) && !bundle.card.cardImageUrl) {
    emitProgress(input.onProgress, "card", "Story photo pasted on FUT plate");
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
  });

  emitProgress(input.onProgress, "done", "Card ready", bundle.sharePath);
  return { ...bundle, audioUrl, reused: false };
}
