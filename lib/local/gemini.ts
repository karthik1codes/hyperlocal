import "server-only";
import type { LocalNewsHit } from "./types";

export type GeminiCardDraft = {
  question: string;
  cardName: string;
  summary: string;
  category: string;
  /** 0–100 urgency / local interest for scoring heat */
  heat: number;
  deadlineDays: number;
  whyItMatters: string;
};

function geminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY?.trim().replace(/\s+/g, "") || undefined;
}

export function hasGeminiCredentials(): boolean {
  return Boolean(geminiApiKey());
}

function geminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";
}

/**
 * Card plate image model — prefer the small/fast Lite over full Nano Banana.
 * Override with GEMINI_IMAGE_MODEL (e.g. gemini-2.5-flash-image, gemini-3.1-flash-image).
 */
function geminiImageModel(): string {
  return process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-3.1-flash-lite-image";
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence?.[1]?.trim() || trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function normalizeDraft(raw: Record<string, unknown>, fallbackQuestion: string): GeminiCardDraft {
  const question = String(raw.question || fallbackQuestion).trim().slice(0, 200);
  const q = question.endsWith("?") ? question : `${question}?`;
  return {
    question: q,
    cardName: String(raw.cardName || "Local").trim().slice(0, 18),
    summary: String(raw.summary || "").trim().slice(0, 480),
    category: String(raw.category || "Hyper-Local").trim().slice(0, 40),
    heat: clamp(Number(raw.heat) || 55, 0, 100),
    deadlineDays: clamp(Math.round(Number(raw.deadlineDays) || 90), 7, 365),
    whyItMatters: String(raw.whyItMatters || "").trim().slice(0, 280),
  };
}

export type LocalProblemBrief = {
  /** Plain-language summary of what the user is asking about. */
  summary: string;
  /** Strong news-search query (no region — caller prepends city). */
  crawlQuery: string;
  /** Short focus phrase for corroboration tabs. */
  focus: string;
};

/**
 * Summarize the user's local problem into a strong crawl request before browsing news.
 */
export async function summarizeLocalProblemForCrawl(input: {
  region: string;
  topic: string;
}): Promise<LocalProblemBrief | null> {
  const apiKey = geminiApiKey();
  if (!apiKey) return null;

  const region = input.region.trim();
  const topic = input.topic.trim();
  if (region.length < 2 || topic.length < 4) return null;

  const prompt = `You turn messy hyper-local user problems into a strong news crawl request.

City / region: ${region}
User local problem (may be messy speech, slang, or a Will… question):
"""
${topic.slice(0, 500)}
"""

Return ONLY valid JSON:
{
  "summary": "1-2 sentences: what local issue or outcome they care about (plain prose, no letter-by-letter spelling)",
  "crawlQuery": "a strong Google/News search query: concrete nouns, place landmarks, institutions, deadlines — NO city/region name (we add that), NO fluff, under 12 words",
  "focus": "3–6 word focus phrase for Reddit/X corroboration"
}

Rules:
- Prefer verifiable news angles (policy, project, deadline, fee, opening, election, strike, flood).
- Expand vague speech into searchable terms (e.g. "metro late" → "metro phase delay opening").
- Keep crawlQuery punchy and high-signal for local Indian/city news.
- Do not invent a different city. Do not dump the raw user text unchanged if it can be sharpened.`;

  const model = geminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: 256,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[gemini-brief] HTTP ${res.status}: ${body.slice(0, 180)}`);
      return null;
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    const parsed = extractJsonObject(text);
    if (!parsed) return null;

    let crawlQuery = String(parsed.crawlQuery || parsed.query || "").replace(/\s+/g, " ").trim();
    // Drop accidental region prefix so we don't double it in the crawler
    const regionRe = new RegExp(`^${region.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[,:\\-–]?\\s*`, "i");
    crawlQuery = crawlQuery.replace(regionRe, "").trim();
    if (crawlQuery.length < 4) crawlQuery = topic.slice(0, 120);

    const summary = String(parsed.summary || topic).replace(/\s+/g, " ").trim().slice(0, 320);
    const focus = String(parsed.focus || crawlQuery).replace(/\s+/g, " ").trim().slice(0, 80);

    return { summary, crawlQuery: crawlQuery.slice(0, 160), focus };
  } catch (e) {
    console.warn("[gemini-brief]", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Turn crawled news into a crisp Yes/No prediction + card metadata via Gemini.
 */
export async function draftCardWithGemini(input: {
  region: string;
  topic: string;
  hit: LocalNewsHit;
  fallbackQuestion: string;
}): Promise<GeminiCardDraft | null> {
  const apiKey = geminiApiKey();
  if (!apiKey) return null;

  const sourcesBlock =
    input.hit.sources && input.hit.sources.length
      ? `\nCorroborating sources (use for authority; do not invent beyond these):\n${input.hit.sources
          .slice(0, 8)
          .map(
            (s) =>
              `- [${s.kind}] ${s.title}${s.snippet ? ` — ${s.snippet.slice(0, 120)}` : ""} (${s.url})`,
          )
          .join("\n")}`
      : "";

  const prompt = `You are building a hyper-local prediction market card from multi-source local intel (news + Reddit + X/Twitter).

Region: ${input.region}
User topic: ${input.topic}
Primary article title: ${input.hit.title}
Primary article URL: ${input.hit.url}
Primary article summary: ${input.hit.summary}${sourcesBlock}

Return ONLY valid JSON (no markdown) with this shape:
{
  "question": "A single clear Yes/No prediction starting with Will… and ending with ?",
  "cardName": "short FIFA-card name ≤18 chars (city or topic keyword)",
  "summary": "2 sentences: what happened + what would resolve Yes (cite cross-source agreement when present)",
  "category": "one of Transit|Politics|RealEstate|Campus|Weather|Sports|Economy|Hyper-Local",
  "heat": 0-100 integer how time-sensitive / locally heated this is,
  "deadlineDays": integer days until a reasonable resolution window,
  "whyItMatters": "one sentence on asymmetric local information"
}

Rules:
- Question must be falsifiable and local to the region.
- Prefer the user's topic if it is already a Will… question.
- Prefer claims corroborated by news + Reddit/X over single-source rumors.
- Do not invent facts not supported by the article/topic/sources.
- Keep question under 160 characters.
- Write summary in plain prose; do not spell words letter-by-letter or dump raw scrape text.`;

  const model = geminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 512,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[gemini] HTTP ${res.status}: ${body.slice(0, 200)}`);
      if (res.status === 429) {
        console.warn("[gemini] Quota exceeded — card will use template question until quota resets.");
      }
      return null;
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    const parsed = extractJsonObject(text);
    if (!parsed) {
      console.warn("[gemini] could not parse JSON from model");
      return null;
    }
    return normalizeDraft(parsed, input.fallbackQuestion);
  } catch (e) {
    console.warn("[gemini]", e instanceof Error ? e.message : e);
    return null;
  }
}

type GeminiInlinePart = {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
};

/**
 * Generate a complete vertical FUT trading card image (the plate itself).
 * Bake in OVR / position / name / six stats from the scored card.
 */
export async function generateCardImageWithGemini(input: {
  region: string;
  topic: string;
  hit: LocalNewsHit;
  draft?: GeminiCardDraft | null;
  /** Scored card — required so the plate matches scout numbers. */
  card: {
    name: string;
    overall: number;
    position: string;
    country: string;
    finishLabel: string;
    stats: { pac: number; sho: number; pas: number; dri: number; def: number; phy: number };
  };
}): Promise<string | null> {
  const apiKey = geminiApiKey();
  if (!apiKey) return null;

  const { card } = input;
  const category = input.draft?.category || "Hyper-Local";
  const summary = input.draft?.summary || input.hit.summary || input.hit.title;
  const s = card.stats;

  const prompt = `Generate ONE complete FIFA Ultimate Team (FUT) style trading CARD image — the full shield-shaped card plate, not a portrait crop.

Exact text that MUST appear on the card (render clearly, bold condensed sans-serif):
- Overall rating (large, top-left): ${card.overall}
- Position under OVR: ${card.position}
- Player/card name centered under the art: ${card.name.toUpperCase()}
- Six stats in two columns (value then label):
  ${Math.round(s.pac)} PAC    ${Math.round(s.dri)} DRI
  ${Math.round(s.sho)} SHO    ${Math.round(s.def)} DEF
  ${Math.round(s.pas)} PAS    ${Math.round(s.phy)} PHY

Visual design:
- Vertical FUT Champions / Inform RED special card: deep red face, silver metallic border, shield silhouette, faint FUT watermark OK.
- Center art plate: a cinematic scene inspired by this hyper-local news (place, event, or symbolic figure — city, metro, campus, crowd, weather). NOT a website screenshot. NO real celebrity likenesses.
- Small nationality flag hint for ${card.country || input.region} under the position (stylized OK).
- Finish vibe: ${card.finishLabel}. Category mood: ${category}.
- Story context (for the art only, do not print as paragraphs): "${input.hit.title}" — ${summary.slice(0, 280)}
- Region: ${input.region}. Topic: ${input.topic}.

Hard rules:
- Output the FULL card as a single image (rating + flag + art + name + stats all baked in).
- Do NOT leave empty gray silhouette placeholders.
- Do NOT invent different OVR or stat numbers than listed above.
- No extra UI chrome, watermarks of other brands, or QR codes.`;

  const model = geminiImageModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio: "2:3" },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[gemini-image] HTTP ${res.status}: ${body.slice(0, 240)}`);
      return null;
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: GeminiInlinePart[] } }>;
    };
    const parts = data.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      const mime =
        part.inlineData?.mimeType || part.inline_data?.mime_type || "image/png";
      const b64 = part.inlineData?.data || part.inline_data?.data;
      if (b64 && mime.startsWith("image/")) {
        return `data:${mime};base64,${b64}`;
      }
    }
    console.warn("[gemini-image] no image part in response");
    return null;
  } catch (e) {
    console.warn("[gemini-image]", e instanceof Error ? e.message : e);
    return null;
  }
}

/** TTS model. Override with GEMINI_TTS_MODEL. */
function geminiTtsModel(): string {
  return process.env.GEMINI_TTS_MODEL?.trim() || "gemini-2.5-flash-preview-tts";
}

function geminiTtsVoice(): string {
  return process.env.GEMINI_TTS_VOICE?.trim() || "Kore";
}

/** Wrap raw PCM (s16le, mono, 24kHz) from Gemini TTS as a playable WAV data URL. */
function pcmBase64ToWavDataUrl(pcmB64: string, sampleRate = 24_000): string {
  const pcm = Buffer.from(pcmB64, "base64");
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return `data:audio/wav;base64,${Buffer.concat([header, pcm]).toString("base64")}`;
}

/**
 * Narrate a hyper-local problem search briefing with Gemini TTS.
 * Returns a WAV data URL, or null on failure.
 */
export async function speakLocalProblemWithGemini(input: {
  region: string;
  topic: string;
  question: string;
  summary?: string | null;
  whyItMatters?: string | null;
  overall?: number;
  finishLabel?: string;
}): Promise<string | null> {
  const apiKey = geminiApiKey();
  if (!apiKey) return null;

  const bits = [
    `Local problem search for ${input.region}.`,
    `You asked about: ${input.topic.slice(0, 140)}.`,
    `Prediction card: ${input.question}`,
  ];
  if (input.summary) bits.push(input.summary.slice(0, 220));
  if (input.whyItMatters) bits.push(`Why it matters: ${input.whyItMatters.slice(0, 160)}`);
  if (input.overall != null) {
    bits.push(`Scout rating ${input.overall}${input.finishLabel ? `, ${input.finishLabel}` : ""}.`);
  }

  const prompt = `Speak this as a short sports-scout briefing. Natural pace. Never spell words or abbreviations letter by letter. Do not read URLs, IDs, or punctuation marks aloud. Do not narrate stage directions.\n\n${bits.join("\n")}`;

  const model = geminiTtsModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: geminiTtsVoice() },
            },
          },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[gemini-tts] HTTP ${res.status}: ${body.slice(0, 240)}`);
      return null;
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: GeminiInlinePart[] } }>;
    };
    const parts = data.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      const mime =
        part.inlineData?.mimeType || part.inline_data?.mime_type || "";
      const b64 = part.inlineData?.data || part.inline_data?.data;
      if (!b64) continue;
      // Gemini TTS returns raw PCM (often as audio/L16;codec=pcm;rate=24000)
      if (mime.includes("wav") || mime === "audio/wav") {
        return `data:audio/wav;base64,${b64}`;
      }
      if (mime.startsWith("audio/") || mime.includes("pcm") || mime.includes("L16") || !mime) {
        return pcmBase64ToWavDataUrl(b64);
      }
    }
    console.warn("[gemini-tts] no audio part in response");
    return null;
  } catch (e) {
    console.warn("[gemini-tts]", e instanceof Error ? e.message : e);
    return null;
  }
}
