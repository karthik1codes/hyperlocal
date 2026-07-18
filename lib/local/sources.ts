import "server-only";
import type { LocalNewsSource } from "./types";
import { emitProgress, type ResearchProgress } from "./progress";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 BentoCards/1.0";

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Reddit public search JSON — no OAuth required. */
export async function fetchRedditSources(
  query: string,
  onProgress?: ResearchProgress,
): Promise<LocalNewsSource[]> {
  emitProgress(onProgress, "search", "Opening Reddit search…", query.slice(0, 100));
  try {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=relevance&t=month&limit=8&type=link`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": UA },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      console.warn(`[reddit] HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as {
      data?: {
        children?: Array<{
          data?: {
            title?: string;
            url?: string;
            permalink?: string;
            selftext?: string;
            subreddit?: string;
            ups?: number;
          };
        }>;
      };
    };
    const out: LocalNewsSource[] = [];
    for (const child of data.data?.children || []) {
      const d = child.data;
      if (!d?.title) continue;
      const link =
        d.url && /^https?:/i.test(d.url) && !/reddit\.com\/r\//i.test(d.url)
          ? d.url
          : d.permalink
            ? `https://www.reddit.com${d.permalink}`
            : null;
      if (!link) continue;
      out.push({
        kind: "reddit",
        title: d.title.slice(0, 180),
        url: link,
        snippet: (d.selftext || `r/${d.subreddit || "all"} · ${d.ups ?? 0} ups`).slice(0, 240),
      });
      if (out.length >= 5) break;
    }
    emitProgress(
      onProgress,
      "search",
      out.length ? `Reddit: ${out.length} posts` : "Reddit: no posts",
    );
    return out;
  } catch (e) {
    console.warn("[reddit]", e instanceof Error ? e.message : e);
    emitProgress(onProgress, "search", "Reddit unavailable", "continuing with other sources");
    return [];
  }
}

/**
 * X/Twitter via DuckDuckGo HTML (site:x.com / site:twitter.com).
 * Avoids needing X API keys; best-effort corroboration only.
 */
export async function fetchTwitterSources(
  query: string,
  onProgress?: ResearchProgress,
): Promise<LocalNewsSource[]> {
  emitProgress(onProgress, "search", "Searching X/Twitter via DuckDuckGo…", query.slice(0, 100));
  try {
    const q = `${query} (site:x.com OR site:twitter.com)`;
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const res = await fetch(searchUrl, {
      headers: { Accept: "text/html", "User-Agent": UA },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      console.warn(`[twitter-ddg] HTTP ${res.status}`);
      return [];
    }
    const html = await res.text();
    const linkRe =
      /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const out: LocalNewsSource[] = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) && out.length < 5) {
      let href = m[1] || "";
      const uddg = href.match(/[?&]uddg=([^&]+)/);
      if (uddg) {
        try {
          href = decodeURIComponent(uddg[1]!);
        } catch {
          /* keep */
        }
      }
      if (!/^https?:/i.test(href)) continue;
      if (!/(twitter\.com|x\.com)\//i.test(href)) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      const title = stripTags(m[2] || "").slice(0, 180);
      if (title.length < 8) continue;
      out.push({
        kind: "twitter",
        title,
        url: href,
        snippet: "X/Twitter public discussion",
      });
    }
    emitProgress(
      onProgress,
      "search",
      out.length ? `X/Twitter: ${out.length} hits` : "X/Twitter: no hits",
    );
    return out;
  } catch (e) {
    console.warn("[twitter]", e instanceof Error ? e.message : e);
    emitProgress(onProgress, "search", "X/Twitter unavailable", "continuing with other sources");
    return [];
  }
}

/** Parallel Reddit + X corroboration for a local problem query. */
export async function fetchSocialCorroboration(
  query: string,
  onProgress?: ResearchProgress,
): Promise<LocalNewsSource[]> {
  const [reddit, twitter] = await Promise.all([
    fetchRedditSources(query, onProgress),
    fetchTwitterSources(query, onProgress),
  ]);
  return [...reddit, ...twitter];
}
