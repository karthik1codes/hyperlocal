import "server-only";
import type { LocalNewsHit } from "./types";
import { hasAnakinCredentials, anakinApiKey } from "./config";
import { emitProgress, type ResearchProgress } from "./progress";

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

function looksLikeImageUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (/\/\/(logo|icon|sprite|avatar|gravatar|tracking|pixel)\./i.test(url)) return false;
  if (/\.(svg)(\?|$)/i.test(url) && /logo|icon/i.test(url)) return false;
  return true;
}

/** Pull og:image / twitter:image / first large img from an article HTML page. */
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
      /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
    ];
    for (const re of patterns) {
      const m = body.match(re);
      const abs = absUrl(m?.[1], finalUrl);
      if (abs && looksLikeImageUrl(abs)) return abs;
    }
    // First reasonably sized content image
    const imgRe = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = imgRe.exec(body))) {
      const abs = absUrl(m[1], finalUrl);
      if (!abs || !looksLikeImageUrl(abs)) continue;
      if (/logo|icon|sprite|1x1|pixel|badge|avatar/i.test(abs)) continue;
      return abs;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Anakin scrape — ask for markdown/html and mine image URLs. */
export async function extractImageViaAnakin(pageUrl: string): Promise<string | null> {
  if (!hasAnakinCredentials() || !pageUrl.startsWith("http")) return null;
  const key = anakinApiKey();
  if (!key) return null;

  try {
    const res = await fetch("https://api.anakin.io/v1/scrape", {
      method: "POST",
      headers: {
        "X-API-Key": key,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        url: pageUrl,
        formats: ["markdown", "html", "summary"],
        useBrowser: false,
        country: "in",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      markdown?: string;
      html?: string;
      images?: Array<string | { url?: string }>;
      ogImage?: string;
      image?: string;
    };

    if (typeof data.ogImage === "string" && looksLikeImageUrl(data.ogImage)) return data.ogImage;
    if (typeof data.image === "string" && looksLikeImageUrl(data.image)) return data.image;
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
      /og:image[^>"']*["'](https?:\/\/[^"']+)["']|(https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp))/i,
    );
    const candidate = og?.[1] || og?.[2];
    if (candidate && looksLikeImageUrl(candidate)) return candidate;
  } catch (e) {
    console.warn("[story-image] anakin scrape:", e instanceof Error ? e.message : e);
  }
  return null;
}

/** Wikipedia page thumbnail related to region + topic (last-resort scene photo). */
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
 * Resolve a photo that matches the hyper-local problem for the card portrait.
 * Prefer article OG → Anakin scrape → Wikipedia thumb.
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

  emitProgress(onProgress, "extract", "Finding story photo…");

  if (hit.url.startsWith("http")) {
    const og = await extractOgImageFromUrl(hit.url);
    if (og) {
      emitProgress(onProgress, "extract", "Article photo found", hostOf(og) || undefined);
      return og;
    }

    if (hasAnakinCredentials()) {
      emitProgress(onProgress, "extract", "Anakin pulling page images…");
      const viaAnakin = await extractImageViaAnakin(hit.url);
      if (viaAnakin) {
        emitProgress(onProgress, "extract", "Anakin image ready", hostOf(viaAnakin) || undefined);
        return viaAnakin;
      }
    }
  }

  // Also try first corroborating news source URL
  for (const src of hit.sources || []) {
    if (src.kind !== "news" || !src.url?.startsWith("http")) continue;
    if (src.url === hit.url) continue;
    const og = await extractOgImageFromUrl(src.url);
    if (og) {
      emitProgress(onProgress, "extract", "Photo from related source");
      return og;
    }
  }

  emitProgress(onProgress, "extract", "Looking up related scene photo…");
  const wiki = await wikipediaThumbForTopic(region, topic);
  if (wiki) {
    emitProgress(onProgress, "extract", "Related scene photo ready");
    return wiki;
  }

  emitProgress(onProgress, "extract", "No story photo found");
  return null;
}
