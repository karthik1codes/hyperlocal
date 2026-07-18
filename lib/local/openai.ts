import "server-only";
import type { LocalNewsHit } from "./types";

/** Shared draft shape used by scoring / card mint. */
export type CardDraft = {
  question: string;
  cardName: string;
  summary: string;
  category: string;
  heat: number;
  deadlineDays: number;
  whyItMatters: string;
  /** Short outcome labels for the bet UI (not bare Yes/No). */
  optionYes: string;
  optionNo: string;
};

/** @deprecated alias — same as CardDraft */
export type GeminiCardDraft = CardDraft;

export type LocalProblemBrief = {
  summary: string;
  crawlQuery: string;
  focus: string;
};

function openaiApiKey(): string | undefined {
  return (
    process.env.OPENAI_API_KEY?.trim().replace(/\s+/g, "") ||
    process.env.CHATGPT_API_KEY?.trim().replace(/\s+/g, "") ||
    undefined
  );
}

export function hasOpenAICredentials(): boolean {
  return Boolean(openaiApiKey());
}

/** Prefer a small/fast chat model for briefs + drafts. */
function openaiChatModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

/** Image model — gpt-image-1 (preferred) or dall-e-3. */
function openaiImageModel(): string {
  return process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1";
}

function openaiTtsModel(): string {
  return process.env.OPENAI_TTS_MODEL?.trim() || "tts-1";
}

function openaiTtsVoice(): string {
  return process.env.OPENAI_TTS_VOICE?.trim() || "nova";
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

/** Build readable Yes/No labels — never dump the full question into the button. */
export function outcomeLabelsFromQuestion(question: string): { yes: string; no: string } {
  const q = question.replace(/\s+/g, " ").trim();
  // Prefer a short clause after Will…
  const will = q.match(/^will\s+(.+?)\s*\?$/i);
  let core = (will?.[1] || "").trim();
  // Strip nested "resolve yes…" junk from bad templates
  core = core
    .replace(/^["“]+|["”]+$/g, "")
    .replace(/\s*resolve yes.*$/i, "")
    .replace(/\s*for\s+[A-Za-z].*$/i, "")
    .trim()
    .slice(0, 48);
  if (!core || core.length < 8 || /^who\b/i.test(core)) {
    return { yes: "Yes — the outcome happens", no: "No — the outcome fails" };
  }
  return {
    yes: `Yes — ${core}`.slice(0, 80),
    no: `No — not ${core}`.slice(0, 80),
  };
}

function cleanOptionLabel(raw: string, side: "yes" | "no"): string {
  let s = raw.replace(/\s+/g, " ").trim();
  // Drop accidental full-question paste
  if (/resolve yes/i.test(s) || s.length > 85 || /^yes\s*—\s*[“"]?who\b/i.test(s)) {
    return "";
  }
  if (!s) return "";
  if (side === "yes" && !/^yes\b/i.test(s)) s = `Yes — ${s}`;
  if (side === "no" && !/^no\b/i.test(s)) s = `No — ${s}`;
  return s.slice(0, 80);
}

function normalizeDraft(raw: Record<string, unknown>, fallbackQuestion: string): CardDraft {
  const question = String(raw.question || fallbackQuestion).trim().slice(0, 200);
  let q = question.endsWith("?") ? question : `${question}?`;
  // Force Will… form when user asked "who will…"
  if (/^who\b/i.test(q) || /who will be/i.test(q)) {
    const forced = String(raw.question || "").trim();
    if (!/^will\b/i.test(forced)) {
      // keep model question if it already fixed it; else soft template
      if (!/^will\b/i.test(q)) {
        q = `Will a clear winner emerge for this local race within 90 days?`;
      }
    }
  }
  const fallback = outcomeLabelsFromQuestion(q);
  const optionYes =
    cleanOptionLabel(String(raw.optionYes || raw.yesLabel || raw.optionA || ""), "yes") ||
    fallback.yes;
  const optionNo =
    cleanOptionLabel(String(raw.optionNo || raw.noLabel || raw.optionB || ""), "no") ||
    fallback.no;
  return {
    question: q.endsWith("?") ? q : `${q}?`,
    cardName: String(raw.cardName || "Local").trim().slice(0, 18),
    summary: String(raw.summary || "").trim().slice(0, 480),
    category: String(raw.category || "Hyper-Local").trim().slice(0, 40),
    heat: clamp(Number(raw.heat) || 55, 0, 100),
    deadlineDays: clamp(Math.round(Number(raw.deadlineDays) || 90), 7, 365),
    whyItMatters: String(raw.whyItMatters || "").trim().slice(0, 280),
    optionYes,
    optionNo,
  };
}

async function chatJson(prompt: string, maxTokens = 512): Promise<Record<string, unknown> | null> {
  const apiKey = openaiApiKey();
  if (!apiKey) return null;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openaiChatModel(),
      temperature: 0.3,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You return only valid JSON objects. Plain prose in string fields — never spell letter-by-letter.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(`[openai] chat HTTP ${res.status}: ${body.slice(0, 220)}`);
    return null;
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content || "";
  return extractJsonObject(text);
}

/**
 * Summarize the user's local problem into a strong crawl request before browsing news.
 */
export async function summarizeLocalProblemForCrawl(input: {
  region: string;
  topic: string;
}): Promise<LocalProblemBrief | null> {
  if (!openaiApiKey()) return null;
  const region = input.region.trim();
  const topic = input.topic.trim();
  if (region.length < 2 || topic.length < 4) return null;

  const parsed = await chatJson(
    `You turn messy hyper-local user problems into a strong news crawl request.

City / region: ${region}
User local problem (may be messy speech, slang, or a Will… question):
"""
${topic.slice(0, 500)}
"""

Return JSON:
{
  "summary": "1-2 sentences: what local issue or outcome they care about",
  "crawlQuery": "strong Google/News search query: concrete nouns, landmarks, institutions — NO city name (we add it), under 12 words",
  "focus": "3–6 word focus phrase for Reddit/X"
}

Prefer verifiable news angles. Sharpen vague speech into searchable terms.`,
    256,
  );
  if (!parsed) return null;

  let crawlQuery = String(parsed.crawlQuery || parsed.query || "")
    .replace(/\s+/g, " ")
    .trim();
  const regionRe = new RegExp(
    `^${region.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[,:\\-–]?\\s*`,
    "i",
  );
  crawlQuery = crawlQuery.replace(regionRe, "").trim();
  if (crawlQuery.length < 4) crawlQuery = topic.slice(0, 120);

  return {
    summary: String(parsed.summary || topic)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 320),
    crawlQuery: crawlQuery.slice(0, 160),
    focus: String(parsed.focus || crawlQuery)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80),
  };
}

/** Turn crawled news into a Yes/No prediction + card metadata. */
export async function draftCardWithOpenAI(input: {
  region: string;
  topic: string;
  hit: LocalNewsHit;
  fallbackQuestion: string;
}): Promise<CardDraft | null> {
  if (!openaiApiKey()) return null;

  const sourcesBlock =
    input.hit.sources && input.hit.sources.length
      ? `\nCorroborating sources:\n${input.hit.sources
          .slice(0, 8)
          .map(
            (s) =>
              `- [${s.kind}] ${s.title}${s.snippet ? ` — ${s.snippet.slice(0, 120)}` : ""} (${s.url})`,
          )
          .join("\n")}`
      : "";

  const parsed = await chatJson(
    `Build a hyper-local binary prediction market from local intel.

Region: ${input.region}
User topic: ${input.topic}
Primary article title: ${input.hit.title}
Primary article URL: ${input.hit.url}
Primary article summary: ${input.hit.summary}${sourcesBlock}

Return JSON:
{
  "question": "A clear Will…? Yes/No question (never start with Who/What/When)",
  "cardName": "FIFA-card name ≤18 chars",
  "summary": "2 sentences grounded in the article",
  "category": "Transit|Politics|RealEstate|Campus|Weather|Sports|Economy|Hyper-Local",
  "heat": 0-100,
  "deadlineDays": integer,
  "whyItMatters": "one sentence",
  "optionYes": "Yes — <short concrete outcome from the article>",
  "optionNo": "No — <short opposite outcome from the article>"
}

Critical rules for optionYes / optionNo:
- They are the BET BUTTON labels users click.
- Must be concrete outcomes from the crawled response (names, dates, projects), e.g.
  "Yes — Congress forms the next Karnataka govt" / "No — BJP retains power"
  "Yes — Whitefield metro opens before Dec 2026" / "No — opening slips into 2027"
- NEVER paste the full question into the options.
- NEVER use templates like "resolve yes for Bengaluru".
- Keep each option under 70 characters.
- Question must be falsifiable Will…? under 140 chars.`,
    700,
  );
  if (!parsed) return null;
  return normalizeDraft(parsed, input.fallbackQuestion);
}

function plateStyleForFinish(finishLabel: string): {
  plateFile: string;
  colors: string;
} {
  const f = finishLabel.toLowerCase();
  if (f.includes("icon") || f.includes("legend")) {
    return {
      plateFile: "legend.png",
      colors: "deep purple-gold legend plate, ornate metallic border",
    };
  }
  if (f.includes("toty") || f.includes("chrome")) {
    return {
      plateFile: "founder-chrome.png",
      colors: "chrome silver-red special plate, metallic sheen",
    };
  }
  if (f.includes("inform") || f.includes("totw") || f.includes("red")) {
    return {
      plateFile: "founder-red.png",
      colors: "deep red FUT Inform / special card plate, silver trim",
    };
  }
  if (f.includes("gold")) {
    return {
      plateFile: "gold.png",
      colors: "classic FUT 19 gold shield plate, brushed metal top, pale gold bottom, faint FUT watermark",
    };
  }
  if (f.includes("silver")) {
    return {
      plateFile: "silver.png",
      colors: "FUT silver shield plate, cool metallic grey",
    };
  }
  return {
    plateFile: "bronze.png",
    colors: "FUT bronze shield plate, warm copper tones",
  };
}

/**
 * Generate a news-scene portrait (not a full FUT plate) for PlayerCard avatar
 * when Anakin/crawl couldn't find a photo.
 */
export async function generateScenePortraitWithOpenAI(input: {
  region: string;
  topic: string;
  hit: LocalNewsHit;
  draft?: CardDraft | null;
}): Promise<string | null> {
  const apiKey = openaiApiKey();
  if (!apiKey) return null;

  const summary = (input.draft?.summary || input.hit.summary || input.hit.title).slice(0, 220);
  const prompt = `Photorealistic editorial news photograph for a prediction-market trading card portrait.
Location: ${input.region}. Story: "${input.hit.title}".
Context: ${summary}
Topic: ${input.topic}.
Vertical portrait crop, cinematic lighting, filled frame with real-world scene (streets, buildings, crowds, landmarks, or political setting matching the story).
STRICT: No grey silhouette, no empty avatar, no faceless mannequin, no FIFA card chrome, no text overlays, no logos.`;

  const model = openaiImageModel();
  try {
    const isGptImage = /gpt-image/i.test(model);
    const body: Record<string, unknown> = {
      model,
      prompt: prompt.slice(0, 3200),
      n: 1,
    };
    if (isGptImage) {
      body.size = "1024x1024";
      body.quality = process.env.OPENAI_IMAGE_QUALITY?.trim() || "medium";
    } else {
      body.size = "1024x1024";
      body.response_format = "b64_json";
      body.quality = "standard";
    }

    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn(`[openai-scene] HTTP ${res.status}: ${errBody.slice(0, 240)}`);
      return null;
    }
    const data = (await res.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    return await rowToDataUrl(data.data?.[0]);
  } catch (e) {
    console.warn("[openai-scene]", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Generate a full FUT trading card image in the style of public/cards/*.png plates.
 * When the crawl found a source photo, it is attached as the center-art reference.
 */
export async function generateCardImageWithOpenAI(input: {
  region: string;
  topic: string;
  hit: LocalNewsHit;
  draft?: CardDraft | null;
  card: {
    name: string;
    overall: number;
    position: string;
    country: string;
    finishLabel: string;
    stats: { pac: number; sho: number; pas: number; dri: number; def: number; phy: number };
  };
}): Promise<string | null> {
  const apiKey = openaiApiKey();
  if (!apiKey) return null;

  const { card } = input;
  const s = card.stats;
  const style = plateStyleForFinish(card.finishLabel);
  const summary = input.draft?.summary || input.hit.summary || input.hit.title;
  const sourceImageUrl =
    input.hit.imageUrl && input.hit.imageUrl.startsWith("http") ? input.hit.imageUrl : null;

  const prompt = `Create ONE complete FIFA Ultimate Team (FUT) style trading CARD image — the full shield plate, not a portrait crop.
Match ${style.colors} like Bento Cards public/cards/${style.plateFile} (curved top, pointed base, split top art / bottom stats).

Exact text that MUST appear clearly on the card (bold condensed sans-serif):
- Overall (large, top-left): ${card.overall}
- Position under OVR: ${card.position}
- Name centered under the art: ${card.name.toUpperCase()}
- Six stats in two columns:
  ${Math.round(s.pac)} PAC    ${Math.round(s.dri)} DRI
  ${Math.round(s.sho)} SHO    ${Math.round(s.def)} DEF
  ${Math.round(s.pas)} PAS    ${Math.round(s.phy)} PHY

Art (center of plate): ${
    sourceImageUrl
      ? "USE THE ATTACHED SOURCE NEWS PHOTO as the main center artwork (crop/compose into the plate — keep recognizable scene from the article)."
      : `FULL photographic news SCENE for the story — ${input.region}: "${input.hit.title}". Show real-world context (streets, buildings, crowds, landmarks, protests, or politics) filling the entire portrait window. NEVER a blank grey person silhouette, NEVER empty placeholder avatar, NEVER generic faceless mannequin.`
  } Inspired by (${summary.slice(0, 180)}). No real celebrity likenesses beyond what is in the source photo.
Small flag hint for ${card.country || input.region}. Finish: ${card.finishLabel}.

Hard rules:
- Full card only (rating + art + name + stats baked in).
- Do not invent different OVR/stats than listed.
- The center MUST be a filled news photo / cinematic scene matching the local problem — not a silhouette.
- No extra UI chrome, QR codes, or other brand watermarks.
- Vertical portrait composition, shield silhouette.`;

  // Prefer edits when we have a source photo so the article image is literally on the card
  if (sourceImageUrl) {
    const edited = await generateCardFromSourcePhoto(apiKey, sourceImageUrl, prompt);
    if (edited) return edited;
  }

  return generateCardFromPrompt(apiKey, prompt);
}

async function fetchImageBytes(
  url: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "image/*,*/*",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0]!.trim();
    if (!mime.startsWith("image/")) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 500 || bytes.length > 8_000_000) return null;
    return { bytes, mime };
  } catch {
    return null;
  }
}

async function generateCardFromSourcePhoto(
  apiKey: string,
  sourceUrl: string,
  prompt: string,
): Promise<string | null> {
  const img = await fetchImageBytes(sourceUrl);
  if (!img) return null;

  const model = openaiImageModel();
  const ext = img.mime.includes("png") ? "png" : img.mime.includes("webp") ? "webp" : "jpg";

  try {
    const form = new FormData();
    form.append("model", /gpt-image/i.test(model) ? model : "gpt-image-1");
    form.append("prompt", prompt.slice(0, 3200));
    form.append("image", new Blob([new Uint8Array(img.bytes)], { type: img.mime }), `source.${ext}`);
    form.append("size", "1024x1536");
    form.append("quality", process.env.OPENAI_IMAGE_QUALITY?.trim() || "medium");

    const res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn(`[openai-image-edit] HTTP ${res.status}: ${errBody.slice(0, 240)}`);
      return null;
    }

    const data = (await res.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    return await rowToDataUrl(data.data?.[0]);
  } catch (e) {
    console.warn("[openai-image-edit]", e instanceof Error ? e.message : e);
    return null;
  }
}

async function generateCardFromPrompt(apiKey: string, prompt: string): Promise<string | null> {
  const model = openaiImageModel();

  try {
    const isGptImage = /gpt-image/i.test(model);
    const body: Record<string, unknown> = {
      model,
      prompt,
      n: 1,
    };
    if (isGptImage) {
      body.size = "1024x1536";
      body.quality = process.env.OPENAI_IMAGE_QUALITY?.trim() || "medium";
    } else {
      body.size = "1024x1792";
      body.response_format = "b64_json";
      body.quality = "standard";
    }

    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn(`[openai-image] HTTP ${res.status}: ${errBody.slice(0, 280)}`);
      if (isGptImage) {
        return generateWithDalle3(apiKey, prompt);
      }
      return null;
    }

    const data = (await res.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    return await rowToDataUrl(data.data?.[0]);
  } catch (e) {
    console.warn("[openai-image]", e instanceof Error ? e.message : e);
    return null;
  }
}

async function rowToDataUrl(
  row: { b64_json?: string; url?: string } | undefined,
): Promise<string | null> {
  if (!row) return null;
  if (row.b64_json) return `data:image/png;base64,${row.b64_json}`;
  if (row.url) {
    const img = await fetch(row.url);
    if (!img.ok) return null;
    const buf = Buffer.from(await img.arrayBuffer());
    return `data:image/png;base64,${buf.toString("base64")}`;
  }
  return null;
}

async function generateWithDalle3(apiKey: string, prompt: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt: prompt.slice(0, 3900),
        n: 1,
        size: "1024x1792",
        response_format: "b64_json",
        quality: "standard",
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn(`[openai-dalle3] HTTP ${res.status}: ${errBody.slice(0, 220)}`);
      return null;
    }
    const data = (await res.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    const row = data.data?.[0];
    if (row?.b64_json) return `data:image/png;base64,${row.b64_json}`;
    if (row?.url) {
      const img = await fetch(row.url);
      if (!img.ok) return null;
      const buf = Buffer.from(await img.arrayBuffer());
      return `data:image/png;base64,${buf.toString("base64")}`;
    }
    return null;
  } catch (e) {
    console.warn("[openai-dalle3]", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Narrate briefing with OpenAI TTS — returns audio/mpeg data URL. */
export async function speakLocalProblemWithOpenAI(input: {
  region: string;
  topic: string;
  question: string;
  summary?: string | null;
  whyItMatters?: string | null;
  overall?: number;
  finishLabel?: string;
}): Promise<string | null> {
  const apiKey = openaiApiKey();
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

  const text = bits.join(" ").slice(0, 4000);

  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openaiTtsModel(),
        voice: openaiTtsVoice(),
        input: text,
        response_format: "mp3",
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[openai-tts] HTTP ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:audio/mpeg;base64,${buf.toString("base64")}`;
  } catch (e) {
    console.warn("[openai-tts]", e instanceof Error ? e.message : e);
    return null;
  }
}
