import "server-only";
import type { LocalNewsHit } from "./types";
import { hasAnakinCredentials, anakinApiKey } from "./config";
import { emitProgress, type ResearchProgress } from "./progress";

const ANAKIN_BASE = "https://api.anakin.io/v1";

function absUrl(href: string | null | undefined, base: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function anakinHeaders(): HeadersInit {
  const key = anakinApiKey();
  if (!key) throw new Error("ANAKIN_API_KEY missing");
  return {
    "X-API-Key": key,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export function looksLikeImageUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (/\/\/(logo|icon|sprite|avatar|gravatar|tracking|pixel)\./i.test(url)) return false;
  if (/\.(svg)(\?|$)/i.test(url) && /logo|icon/i.test(url)) return false;
  return true;
}

function pickFromAnakinDoc(data: {
  images?: Array<string | { url?: string }>;
  screenshotUrl?: string;
  fullPageScreenshotUrl?: string;
  ogImage?: string;
  image?: string;
  markdown?: string;
  html?: string;
}): string | null {
  if (typeof data.ogImage === "string" && looksLikeImageUrl(data.ogImage)) return data.ogImage;
  if (typeof data.image === "string" && looksLikeImageUrl(data.image)) return data.image;
  if (typeof data.screenshotUrl === "string" && looksLikeImageUrl(data.screenshotUrl)) {
    return data.screenshotUrl;
  }
  if (
    typeof data.fullPageScreenshotUrl === "string" &&
    looksLikeImageUrl(data.fullPageScreenshotUrl)
  ) {
    return data.fullPageScreenshotUrl;
  }
  if (Array.isArray(data.images)) {
    for (const item of data.images) {
      const u = typeof item === "string" ? item : item?.url;
      if (u && looksLikeImageUrl(u)) return u;
    }
  }
  const blob = `${data.markdown || ""}\n${data.html || ""}`;
  const mdImg = blob.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i);
  if (mdImg?.[1] && looksLikeImageUrl(mdImg[1])) return mdImg[1];
  const og = blob.match(
    /og:image[^>"']*["'](https?:\/\/[^"']+)["']|(https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?)/i,
  );
  const candidate = og?.[1] || og?.[2];
  if (candidate && looksLikeImageUrl(candidate)) return candidate;
  return null;
}

/** Pull og:image from article HTML (HTTP fallback when Anakin is down). */
export async function extractOgImageFromUrl(pageUrl: string): Promise<string | null> {
  if (!pageUrl.startsWith("http")) return null;
  try {
    const res = await fetch(pageUrl, {
      headers: {
        Accept: "text/html",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(18_000),
    });
    if (!res.ok) return null;
    const finalUrl = res.url || pageUrl;
    const body = await res.text();
    const patterns = [
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
      /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
    ];
    for (const re of patterns) {
      const m = body.match(re);
      const abs = absUrl(m?.[1], finalUrl);
      if (abs && looksLikeImageUrl(abs)) return abs;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Anakin scrape with explicit `images` + `screenshot` formats
 * @see https://github.com/Anakin-Inc/anakin-node — formats include images, screenshot
 */
export async function extractImageViaAnakin(pageUrl: string): Promise<string | null> {
  if (!hasAnakinCredentials() || !pageUrl.startsWith("http")) return null;

  const attempts: Array<{ useBrowser: boolean; label: string }> = [
    { useBrowser: false, label: "http" },
    { useBrowser: true, label: "browser" },
  ];

  for (const attempt of attempts) {
    try {
      const res = await fetch(`${ANAKIN_BASE}/scrape`, {
        method: "POST",
        headers: anakinHeaders(),
        body: JSON.stringify({
          url: pageUrl,
          formats: ["images", "screenshot", "markdown", "html", "summary"],
          useBrowser: attempt.useBrowser,
          country: "in",
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(55_000),
      });

      if (!res.ok) {
        // Async job path
        if (res.status === 404 || res.status === 405 || res.status === 408) {
          const asyncImg = await extractImageViaAnakinAsync(pageUrl, attempt.useBrowser);
          if (asyncImg) return asyncImg;
        }
        console.warn(
          `[story-image] anakin scrape ${attempt.label} HTTP ${res.status}`,
        );
        continue;
      }

      const data = (await res.json()) as Parameters<typeof pickFromAnakinDoc>[0] & {
        status?: string;
        id?: string;
        jobId?: string;
      };

      const picked = pickFromAnakinDoc(data);
      if (picked) return picked;

      const jobId = data.jobId || data.id;
      if (jobId && (data.status === "pending" || data.status === "processing")) {
        const polled = await pollAnakinScrapeImages(jobId);
        if (polled) return polled;
      }
    } catch (e) {
      console.warn(
        `[story-image] anakin scrape ${attempt.label}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return null;
}

async function extractImageViaAnakinAsync(
  pageUrl: string,
  useBrowser: boolean,
): Promise<string | null> {
  try {
    const res = await fetch(`${ANAKIN_BASE}/url-scraper`, {
      method: "POST",
      headers: anakinHeaders(),
      body: JSON.stringify({
        url: pageUrl,
        formats: ["images", "screenshot", "markdown", "html"],
        useBrowser,
        country: "in",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { jobId?: string; id?: string };
    const jobId = data.jobId || data.id;
    if (!jobId) return null;
    return pollAnakinScrapeImages(jobId);
  } catch {
    return null;
  }
}

async function pollAnakinScrapeImages(jobId: string): Promise<string | null> {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const res = await fetch(`${ANAKIN_BASE}/url-scraper/${encodeURIComponent(jobId)}`, {
        headers: anakinHeaders(),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as Parameters<typeof pickFromAnakinDoc>[0] & {
        status?: string;
      };
      if (data.status === "failed") return null;
      if (data.status === "completed" || data.images || data.screenshotUrl || data.markdown) {
        const picked = pickFromAnakinDoc(data);
        if (picked) return picked;
        if (data.status === "completed") return null;
      }
    } catch {
      /* retry */
    }
  }
  return null;
}

/**
 * Anakin web search aimed at finding a news photo for the local problem.
 */
export async function searchImageViaAnakin(
  region: string,
  topic: string,
): Promise<string | null> {
  if (!hasAnakinCredentials()) return null;
  try {
    const prompt = `${region} ${topic} — find a recent news article with a photo about this local story. Prefer image URLs.`;
    const res = await fetch(`${ANAKIN_BASE}/search`, {
      method: "POST",
      headers: anakinHeaders(),
      body: JSON.stringify({ prompt, limit: 8 }),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: Array<{
        url?: string;
        title?: string;
        image?: string;
        imageUrl?: string;
        thumbnail?: string;
        ogImage?: string;
      }>;
    };
    const results = Array.isArray(data.results) ? data.results : [];
    for (const r of results) {
      for (const key of ["image", "imageUrl", "thumbnail", "ogImage"] as const) {
        const u = r[key];
        if (typeof u === "string" && looksLikeImageUrl(u)) return u;
      }
    }
    // Scrape top result pages for images via Anakin
    for (const r of results.slice(0, 3)) {
      if (!r.url?.startsWith("http")) continue;
      const img = await extractImageViaAnakin(r.url);
      if (img) return img;
    }
  } catch (e) {
    console.warn("[story-image] anakin image search:", e instanceof Error ? e.message : e);
  }
  return null;
}

/** Wikipedia page thumbnail — last resort, not Anakin. */
export async function wikipediaThumbForTopic(
  region: string,
  topic: string,
): Promise<string | null> {
  const query = `${region} ${topic}`.replace(/\s+/g, " ").trim().slice(0, 120);
  if (query.length < 4) return null;
  try {
    const api = new URL("https://en.wikipedia.org/w/api.php");
    api.searchParams.set("action", "query");
    api.searchParams.set("generator", "search");
    api.searchParams.set("gsrsearch", query);
    api.searchParams.set("gsrlimit", "5");
    api.searchParams.set("prop", "pageimages");
    api.searchParams.set("piprop", "thumbnail");
    api.searchParams.set("pithumbsize", "800");
    api.searchParams.set("format", "json");
    api.searchParams.set("origin", "*");

    const res = await fetch(api.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      query?: { pages?: Record<string, { thumbnail?: { source?: string } }> };
    };
    const pages = Object.values(data.query?.pages || {});
    for (const page of pages) {
      const src = page.thumbnail?.source;
      if (src && looksLikeImageUrl(src)) return src;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Resolve a photo for the card portrait — Anakin first (images/screenshot scrape
 * + image search). No OpenAI image generation.
 */
export async function resolveStoryImage(input: {
  hit: LocalNewsHit;
  region: string;
  topic: string;
  onProgress?: ResearchProgress;
}): Promise<string | null> {
  const { hit, region, topic, onProgress } = input;

  if (hit.imageUrl && looksLikeImageUrl(hit.imageUrl)) {
    return hit.imageUrl;
  }

  const hasAnakin = hasAnakinCredentials();
  if (!hasAnakin) {
    emitProgress(
      onProgress,
      "extract",
      "No ANAKIN_API_KEY — set it so Anakin can pull story photos",
    );
  }

  // 1) Anakin scrape of the primary article (images + screenshot formats)
  if (hasAnakin && hit.url.startsWith("http")) {
    emitProgress(onProgress, "extract", "Anakin fetching page images…");
    const viaAnakin = await extractImageViaAnakin(hit.url);
    if (viaAnakin) {
      emitProgress(onProgress, "extract", "Anakin image ready", hostOf(viaAnakin) || undefined);
      return viaAnakin;
    }
  }

  // 2) Anakin scrape of corroborating news sources
  if (hasAnakin) {
    for (const src of hit.sources || []) {
      if (src.kind !== "news" || !src.url?.startsWith("http")) continue;
      if (src.url === hit.url) continue;
      emitProgress(onProgress, "extract", "Anakin checking related source…");
      const img = await extractImageViaAnakin(src.url);
      if (img) {
        emitProgress(onProgress, "extract", "Anakin image from related source");
        return img;
      }
    }
  }

  // 3) Anakin search specifically for a photo of this local problem
  if (hasAnakin) {
    emitProgress(onProgress, "extract", "Anakin searching for story photo…");
    const searched = await searchImageViaAnakin(region, topic);
    if (searched) {
      emitProgress(onProgress, "extract", "Anakin photo search hit");
      return searched;
    }
  }

  // 4) Light HTTP og:image (no OpenAI)
  if (hit.url.startsWith("http")) {
    const og = await extractOgImageFromUrl(hit.url);
    if (og) {
      emitProgress(onProgress, "extract", "Article OG photo found", hostOf(og) || undefined);
      return og;
    }
  }

  // 5) Wikipedia thumb last resort
  emitProgress(onProgress, "extract", "Looking up related scene photo…");
  const wiki = await wikipediaThumbForTopic(region, topic);
  if (wiki) {
    emitProgress(onProgress, "extract", "Related scene photo ready");
    return wiki;
  }

  emitProgress(
    onProgress,
    "extract",
    hasAnakin
      ? "Anakin found no photo for this story"
      : "No story photo — add ANAKIN_API_KEY to enable Anakin image fetch",
  );
  return null;
}
