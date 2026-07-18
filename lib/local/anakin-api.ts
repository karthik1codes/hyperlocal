import "server-only";
import { anakinApiKey, hasAnakinCredentials } from "./config";
import type { LocalNewsHit, LocalNewsSource } from "./types";
import { emitProgress, type ResearchProgress } from "./progress";

const ANAKIN_BASE = "https://api.anakin.io/v1";

function headers(): HeadersInit {
  const key = anakinApiKey();
  if (!key) throw new Error("ANAKIN_API_KEY missing");
  return {
    "X-API-Key": key,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Anakin Search API — AI web search. Prefer concise `summary` / answer fields;
 * never dump raw result blobs into the UI.
 */
export async function researchViaAnakinSearch(input: {
  region: string;
  topic: string;
  onProgress?: ResearchProgress;
}): Promise<LocalNewsHit> {
  if (!hasAnakinCredentials()) {
    throw new Error("ANAKIN_API_KEY required for Anakin search.");
  }

  const prompt = `${input.region}: ${input.topic}. Local news and what is happening now.`;
  emitProgress(input.onProgress, "search", "Anakin summarizing local news…");

  const res = await fetch(`${ANAKIN_BASE}/search`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ prompt, limit: 6 }),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anakin search failed (${res.status}): ${body.slice(0, 120)}`);
  }

  const data = (await res.json()) as {
    summary?: string;
    answer?: string;
    results?: Array<{
      url?: string;
      title?: string;
      snippet?: string;
    }>;
  };

  const results = Array.isArray(data.results) ? data.results : [];
  const top = results.find((r) => r.url?.startsWith("http"));
  if (!top?.url) {
    throw new Error("Anakin search returned no usable sources.");
  }

  const title = (top.title || input.topic).replace(/\s+/g, " ").trim().slice(0, 200);
  // Prefer AI summary — short, not the full scraped page
  const summary = (
    data.summary ||
    data.answer ||
    results
      .map((r) => r.snippet)
      .filter(Boolean)
      .slice(0, 3)
      .join(" ") ||
    top.snippet ||
    title
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 480);

  const sources: LocalNewsSource[] = results
    .filter((r) => r.url?.startsWith("http"))
    .slice(0, 8)
    .map((r) => ({
      kind: "news" as const,
      title: (r.title || "Source").slice(0, 180),
      url: r.url!,
      snippet: (r.snippet || "").slice(0, 160),
    }));

  emitProgress(input.onProgress, "extract", "Anakin summary ready");

  // Anakin first for images (formats: images + screenshot), then OG
  let imageUrl: string | null = null;
  try {
    const { extractImageViaAnakin, extractOgImageFromUrl } = await import("./story-image");
    imageUrl = await extractImageViaAnakin(top.url);
    if (!imageUrl) imageUrl = await extractOgImageFromUrl(top.url);
  } catch (e) {
    console.warn("[anakin/search] image:", e instanceof Error ? e.message : e);
  }

  return {
    title,
    url: top.url,
    summary,
    imageUrl,
    sourceHost: hostOf(top.url),
    sources,
  };
}

/**
 * Enrich an existing hit with Anakin's AI page summary (formats: summary).
 * Soft-fails — returns the original hit if scrape/summary unavailable.
 */
export async function summarizeHitWithAnakin(
  hit: LocalNewsHit,
  onProgress?: ResearchProgress,
): Promise<LocalNewsHit> {
  if (!hasAnakinCredentials() || !hit.url.startsWith("http")) return hit;

  emitProgress(onProgress, "extract", "Anakin refining summary…");

  try {
    // Sync scrape — returns summary when formats include it
    const res = await fetch(`${ANAKIN_BASE}/scrape`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        url: hit.url,
        formats: ["images", "screenshot", "summary", "markdown", "html"],
        useBrowser: false,
        country: "in",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(35_000),
    });

    if (!res.ok) {
      // Fall back to async job style if sync rejects
      if (res.status === 404 || res.status === 405) {
        return await summarizeViaUrlScraper(hit, onProgress);
      }
      return hit;
    }

    const data = (await res.json()) as {
      summary?: string;
      status?: string;
      id?: string;
      jobId?: string;
      markdown?: string;
      html?: string;
      ogImage?: string;
      image?: string;
      images?: Array<string | { url?: string }>;
    };

    let imageUrl = hit.imageUrl;
    if (!imageUrl) {
      if (typeof data.ogImage === "string" && data.ogImage.startsWith("http")) {
        imageUrl = data.ogImage;
      } else if (typeof data.image === "string" && data.image.startsWith("http")) {
        imageUrl = data.image;
      } else if (Array.isArray(data.images)) {
        for (const item of data.images) {
          const u = typeof item === "string" ? item : item?.url;
          if (u?.startsWith("http")) {
            imageUrl = u;
            break;
          }
        }
      } else {
        const blob = `${data.markdown || ""}\n${data.html || ""}`;
        const md = blob.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/);
        if (md?.[1]) imageUrl = md[1];
      }
    }

    if (data.summary && data.summary.trim().length > 40) {
      emitProgress(onProgress, "extract", "Summary refined");
      return {
        ...hit,
        summary: data.summary.replace(/\s+/g, " ").trim().slice(0, 480),
        imageUrl: imageUrl || hit.imageUrl,
      };
    }

    if (imageUrl && imageUrl !== hit.imageUrl) {
      return { ...hit, imageUrl };
    }

    // Async job accepted
    const jobId = data.jobId || data.id;
    if (jobId && (data.status === "pending" || data.status === "processing")) {
      return await pollUrlScraperSummary(hit, jobId, onProgress);
    }

    return hit;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.error(`[anakin/summarize] soft-fail: ${msg}`);
    if (stack) console.error(stack);
    return hit;
  }
}

async function summarizeViaUrlScraper(
  hit: LocalNewsHit,
  onProgress?: ResearchProgress,
): Promise<LocalNewsHit> {
  const res = await fetch(`${ANAKIN_BASE}/url-scraper`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      url: hit.url,
      formats: ["summary"],
      useBrowser: false,
      country: "in",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return hit;
  const data = (await res.json()) as { jobId?: string; id?: string };
  const jobId = data.jobId || data.id;
  if (!jobId) return hit;
  return pollUrlScraperSummary(hit, jobId, onProgress);
}

async function pollUrlScraperSummary(
  hit: LocalNewsHit,
  jobId: string,
  onProgress?: ResearchProgress,
): Promise<LocalNewsHit> {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const res = await fetch(`${ANAKIN_BASE}/url-scraper/${encodeURIComponent(jobId)}`, {
        headers: headers(),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        status?: string;
        summary?: string;
        error?: string;
      };
      if (data.status === "failed") return hit;
      if (data.status === "completed" && data.summary?.trim()) {
        emitProgress(onProgress, "extract", "Summary refined");
        return {
          ...hit,
          summary: data.summary.replace(/\s+/g, " ").trim().slice(0, 480),
        };
      }
      if (data.status === "completed") return hit;
    } catch {
      /* retry */
    }
  }
  return hit;
}
