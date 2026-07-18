import "server-only";
import type { Browser, BrowserContext, LaunchOptions, Page } from "playwright";
import {
  anakinApiKey,
  anakinBrowserWsUrl,
  hasAnakinCredentials,
  isServerlessRuntime,
  localAllowAnakinFallback,
  localBrowserHeaded,
  newsBrowserMode,
  preferLocalBrowser,
} from "./config";
import type { LocalNewsHit } from "./types";
import { emitProgress, type ResearchProgress } from "./progress";
import { fetchSocialCorroboration } from "./sources";
import {
  researchViaAnakinSearch,
  summarizeHitWithAnakin,
} from "./anakin-api";

export type { LocalNewsHit };

async function loadChromium() {
  const { chromium } = await import("playwright");
  return chromium;
}

/** One local browser at a time — prevents Windows spawn EBUSY under auto-fetch. */
let launchLock: Promise<void> = Promise.resolve();

function withLaunchLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = launchLock.then(fn, fn);
  launchLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function isBusyError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /EBUSY|EPERM|EACCES|Failed to launch|spawn|Executable doesn't exist/i.test(msg);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

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

async function launchLocalBrowser(
  onProgress?: ResearchProgress,
): Promise<Browser> {
  const headed = localBrowserHeaded();

  // System Chrome/Edge only — avoid Playwright headless_shell (EBUSY on Windows).
  const attempts: Array<{ label: string; options: LaunchOptions }> = [
    {
      label: headed ? "Chrome (visible tabs)" : "Chrome (headless)",
      options: {
        channel: "chrome",
        headless: !headed,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-sandbox",
          "--start-maximized",
        ],
      },
    },
    {
      label: headed ? "Edge (visible tabs)" : "Edge (headless)",
      options: {
        channel: "msedge",
        headless: !headed,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-sandbox",
          "--start-maximized",
        ],
      },
    },
  ];

  let lastErr: unknown;
  for (const attempt of attempts) {
    for (let tryN = 0; tryN < 2; tryN++) {
      try {
        emitProgress(
          onProgress,
          "connect",
          `Launching ${attempt.label}…`,
          tryN ? `retry ${tryN + 1}` : undefined,
        );
        const chromium = await loadChromium();
        const browser = await chromium.launch(attempt.options);
        emitProgress(onProgress, "connect", "Local browser ready", attempt.label);
        return browser;
      } catch (e) {
        lastErr = e;
        if (!isBusyError(e) && tryN === 0) break;
        await sleep(500 * (tryN + 1));
      }
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(
    `Could not launch Chrome/Edge. Install Google Chrome, close stuck chrome.exe processes, then retry. Detail: ${msg.slice(0, 220)}`,
  );
}

async function withAnakinPage<T>(
  fn: (page: Page) => Promise<T>,
  onProgress?: ResearchProgress,
): Promise<T> {
  const apiKey = anakinApiKey();
  if (!apiKey) throw new Error("ANAKIN_API_KEY missing for Anakin mode.");
  emitProgress(onProgress, "connect", "Connecting to Anakin browser…");
  const chromium = await loadChromium();
  const browser = await chromium.connectOverCDP(anakinBrowserWsUrl(), {
    headers: { "X-API-Key": apiKey },
    timeout: 90_000,
  });
  try {
    emitProgress(onProgress, "connect", "Anakin session ready", "remote CDP");
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(60_000);
    return await fn(page);
  } finally {
    try {
      await browser.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Local Chrome: Tab 1 = Google search, Tab 2 = article,
 * plus parallel Reddit + X/Twitter corroboration for authoritative signal.
 */
async function researchWithVisibleTabs(input: {
  region: string;
  topic: string;
  onProgress?: ResearchProgress;
}): Promise<LocalNewsHit> {
  const query = `${input.region} ${input.topic}`.replace(/\s+/g, " ").trim();

  return withLaunchLock(async () => {
    const browser = await launchLocalBrowser(input.onProgress);
    let context: BrowserContext | null = null;
    try {
      // Kick off Reddit + X in parallel with the browser news crawl
      const socialPromise = fetchSocialCorroboration(query, input.onProgress);

      context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        viewport: { width: 1360, height: 900 },
        locale: "en-IN",
      });

      // ——— Tab 1: Google (type query like a human) ———
      const searchTab = await context.newPage();
      searchTab.setDefaultTimeout(60_000);
      emitProgress(input.onProgress, "search", "Opening Google in a new tab…");
      await searchTab.goto("https://www.google.com/?hl=en", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await sleep(800);

      // Cookie / consent banners (best-effort)
      try {
        const consent = searchTab
          .locator("button:has-text('Accept all'), button:has-text('I agree'), button:has-text('Accept')")
          .first();
        if (await consent.isVisible({ timeout: 1500 })) await consent.click();
      } catch {
        /* no banner */
      }

      emitProgress(input.onProgress, "search", "Typing search query…", query.slice(0, 120));
      const box = searchTab.locator("textarea[name='q'], input[name='q']").first();
      await box.click({ timeout: 15_000 });
      await box.fill("");
      await box.type(query, { delay: 18 });
      await searchTab.keyboard.press("Enter");
      await searchTab.waitForLoadState("domcontentloaded");
      await sleep(1200);

      // Prefer News tab if present
      try {
        const newsTabBtn = searchTab.locator("a", { hasText: /^News$/i }).first();
        if (await newsTabBtn.isVisible({ timeout: 2000 })) {
          emitProgress(input.onProgress, "search", "Switching to Google News tab…");
          await newsTabBtn.click();
          await searchTab.waitForLoadState("domcontentloaded");
          await sleep(1000);
        }
      } catch {
        /* stay on All */
      }

      // ——— Extra tabs: Reddit + DuckDuckGo X (visible corroboration) ———
      const redditTab = await context.newPage();
      const twitterTab = await context.newPage();
      redditTab.setDefaultTimeout(45_000);
      twitterTab.setDefaultTimeout(45_000);
      emitProgress(input.onProgress, "search", "Opening Reddit + X search tabs…");
      await Promise.allSettled([
        redditTab.goto(
          `https://www.reddit.com/search/?q=${encodeURIComponent(query)}&type=link&sort=relevance&t=month`,
          { waitUntil: "domcontentloaded", timeout: 45_000 },
        ),
        twitterTab.goto(
          `https://duckduckgo.com/?q=${encodeURIComponent(`${query} site:x.com OR site:twitter.com`)}`,
          { waitUntil: "domcontentloaded", timeout: 45_000 },
        ),
      ]);
      await sleep(900);

      const candidates = await searchTab.evaluate(() => {
        const out: { title: string; href: string }[] = [];
        const seen = new Set<string>();
        const push = (title: string, href: string) => {
          const t = title.replace(/\s+/g, " ").trim();
          if (!t || t.length < 12 || !href.startsWith("http")) return;
          if (/google\.|gstatic\.|youtube\.|webcache/i.test(href)) return;
          if (seen.has(href)) return;
          seen.add(href);
          out.push({ title: t.slice(0, 180), href });
        };

        for (const a of Array.from(document.querySelectorAll("a[href]"))) {
          const el = a as HTMLAnchorElement;
          const h = el.href || "";
          if (!h.startsWith("http")) continue;
          const h3 = el.querySelector("h3");
          const title = (h3?.textContent || el.textContent || "").trim();
          if (h3 || title.length > 24) push(title, h);
          if (out.length >= 10) break;
        }
        return out;
      });

      if (!candidates.length) {
        emitProgress(input.onProgress, "search", "Retrying via Google News URL…");
        const newsUrl = `https://news.google.com/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
        await searchTab.goto(newsUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await sleep(1500);
        const newsCandidates = await searchTab.evaluate(() => {
          const out: { title: string; href: string }[] = [];
          for (const a of Array.from(document.querySelectorAll("a[href]"))) {
            const el = a as HTMLAnchorElement;
            const t = (el.textContent || "").replace(/\s+/g, " ").trim();
            const h = el.href || "";
            if (t.length < 20 || !h.includes("http")) continue;
            if (/news\.google\.com\/(home|stories|publications)/i.test(h) && !/articles/i.test(h)) {
              continue;
            }
            out.push({ title: t.slice(0, 180), href: h });
            if (out.length >= 8) break;
          }
          return out;
        });
        candidates.push(...newsCandidates);
      }

      // Scrape visible Reddit / DDG tabs as extra sources (best-effort)
      const tabSources: LocalNewsHit["sources"] = [];
      try {
        const redditPosts = await redditTab.evaluate(() => {
          const out: { title: string; href: string }[] = [];
          for (const a of Array.from(
            document.querySelectorAll('a[href*="/comments/"], a[data-click-id="body"]'),
          )) {
            const el = a as HTMLAnchorElement;
            const t = (el.textContent || "").replace(/\s+/g, " ").trim();
            const h = el.href || "";
            if (t.length < 16 || !h.includes("reddit.com")) continue;
            out.push({ title: t.slice(0, 180), href: h });
            if (out.length >= 4) break;
          }
          return out;
        });
        for (const p of redditPosts) {
          tabSources.push({ kind: "reddit", title: p.title, url: p.href, snippet: "Reddit tab" });
        }
      } catch {
        /* ignore */
      }
      try {
        const twPosts = await twitterTab.evaluate(() => {
          const out: { title: string; href: string }[] = [];
          for (const a of Array.from(document.querySelectorAll("a[href]"))) {
            const el = a as HTMLAnchorElement;
            const h = el.href || "";
            if (!/(twitter\.com|x\.com)\//i.test(h)) continue;
            const t = (el.textContent || "").replace(/\s+/g, " ").trim();
            if (t.length < 10) continue;
            out.push({ title: t.slice(0, 180), href: h });
            if (out.length >= 4) break;
          }
          return out;
        });
        for (const p of twPosts) {
          tabSources.push({
            kind: "twitter",
            title: p.title,
            url: p.href,
            snippet: "X/Twitter tab",
          });
        }
      } catch {
        /* ignore */
      }

      if (!candidates.length) {
        throw new Error(
          `No search results for “${query}”. Try a shorter topic (e.g. “IIT Madras fees” or “Whitefield metro”).`,
        );
      }

      const top = candidates[0]!;
      emitProgress(input.onProgress, "pick", "Opening top result in a new tab…", top.title.slice(0, 100));

      // ——— Tab: article ———
      const articleTab = await context.newPage();
      articleTab.setDefaultTimeout(60_000);
      emitProgress(input.onProgress, "open", "Loading article tab…", top.href.slice(0, 120));
      await articleTab.goto(top.href, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await sleep(1200);

      const onGoogleNews = /news\.google\.com/i.test(articleTab.url());
      if (onGoogleNews) {
        try {
          const outbound = await articleTab.evaluate(() => {
            for (const a of Array.from(document.querySelectorAll("a[href]"))) {
              const href = (a as HTMLAnchorElement).href || "";
              if (/^https?:\/\//i.test(href) && !/google\./i.test(href)) return href;
            }
            return null;
          });
          if (outbound) {
            emitProgress(input.onProgress, "open", "Following publisher link…", outbound.slice(0, 120));
            await articleTab.goto(outbound, { waitUntil: "domcontentloaded", timeout: 60_000 });
            await sleep(1000);
          }
        } catch {
          /* keep Google News page */
        }
      }

      emitProgress(input.onProgress, "extract", "Extracting title, summary & image…");
      const article = await articleTab.evaluate(() => {
        const meta = (sel: string) =>
          document.querySelector(sel)?.getAttribute("content")?.trim() || null;
        const title =
          meta('meta[property="og:title"]') ||
          document.querySelector("h1")?.textContent?.trim() ||
          document.title ||
          "";
        const summary =
          meta('meta[property="og:description"]') ||
          meta('meta[name="description"]') ||
          Array.from(document.querySelectorAll("article p, main p, p"))
            .map((p) => (p.textContent || "").replace(/\s+/g, " ").trim())
            .filter((t) => t.length > 60)
            .slice(0, 2)
            .join(" ")
            .slice(0, 420) ||
          "";
        const image =
          meta('meta[property="og:image"]') ||
          meta('meta[name="twitter:image"]') ||
          document.querySelector("article img, main img, img")?.getAttribute("src") ||
          null;
        return {
          title: title.slice(0, 200),
          summary: summary.slice(0, 480),
          image,
          finalUrl: location.href,
        };
      });

      const url = article.finalUrl || top.href;
      const imageUrl = absUrl(article.image, url);
      const summary =
        article.summary ||
        `Local coverage on ${input.region}: ${article.title || top.title}.`;

      const apiSources = await socialPromise.catch(() => [] as Awaited<typeof socialPromise>);
      const sources = [
        { kind: "news" as const, title: (article.title || top.title).slice(0, 180), url, snippet: summary.slice(0, 200) },
        ...tabSources,
        ...apiSources,
      ];
      // Dedup by URL
      const seenUrl = new Set<string>();
      const uniqueSources = sources.filter((s) => {
        if (seenUrl.has(s.url)) return false;
        seenUrl.add(s.url);
        return true;
      });

      emitProgress(
        input.onProgress,
        "extract",
        `Story + ${uniqueSources.length} corroborating sources`,
        (article.title || top.title).slice(0, 100),
      );

      await Promise.allSettled([
        articleTab.close(),
        searchTab.close(),
        redditTab.close(),
        twitterTab.close(),
      ]);

      return {
        title: (article.title || top.title).slice(0, 200),
        url,
        summary,
        imageUrl,
        sourceHost: hostOf(url),
        sources: uniqueSources.slice(0, 12),
      };
    } finally {
      try {
        await context?.close();
      } catch {
        /* ignore */
      }
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
  });
}

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

async function researchViaHttp(input: {
  region: string;
  topic: string;
  onProgress?: ResearchProgress;
}): Promise<LocalNewsHit> {
  const query = `${input.region} ${input.topic}`;
  emitProgress(input.onProgress, "connect", "Using HTTP news scrape (no browser)…");
  const socialPromise = fetchSocialCorroboration(query, input.onProgress);

  const candidates: { title: string; href: string; desc?: string; image?: string }[] = [];

  // 1) Google News RSS — reliable on Vercel serverless
  try {
    emitProgress(input.onProgress, "search", "Fetching Google News RSS…", query.slice(0, 120));
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
    const rssRes = await fetch(rssUrl, {
      headers: { Accept: "application/rss+xml, application/xml, text/xml, */*" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (rssRes.ok) {
      const xml = await rssRes.text();
      const itemRe = /<item>([\s\S]*?)<\/item>/gi;
      let item: RegExpExecArray | null;
      while ((item = itemRe.exec(xml)) && candidates.length < 8) {
        const block = item[1] || "";
        const title = stripTags(block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "");
        const link = stripTags(block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "");
        const desc = stripTags(block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || "");
        const media =
          block.match(/<media:content[^>]+url=["']([^"']+)["']/i)?.[1] ||
          block.match(/<enclosure[^>]+url=["']([^"']+)["']/i)?.[1] ||
          null;
        if (title.length < 12 || !link.startsWith("http")) continue;
        const row: { title: string; href: string; desc?: string; image?: string } = {
          title: title.slice(0, 180),
          href: link,
        };
        if (desc) row.desc = desc.slice(0, 420);
        if (media?.startsWith("http")) row.image = media;
        candidates.push(row);
      }
    }
  } catch (e) {
    logResearchTrace("google-news-rss", e);
  }

  // 2) DuckDuckGo HTML if RSS empty
  if (!candidates.length) {
    emitProgress(input.onProgress, "search", "Fetching DuckDuckGo HTML…", query.slice(0, 120));
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: {
        Accept: "text/html",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP search failed (${res.status})`);
    const html = await res.text();
    const linkRe =
      /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) && candidates.length < 6) {
      let href = m[1] || "";
      const uddg = href.match(/[?&]uddg=([^&]+)/);
      if (uddg) {
        try {
          href = decodeURIComponent(uddg[1]!);
        } catch {
          /* keep */
        }
      }
      const title = stripTags(m[2] || "").slice(0, 180);
      if (!href.startsWith("http") || title.length < 12) continue;
      if (/duckduckgo\.com/i.test(href)) continue;
      candidates.push({ title, href });
    }
  }

  if (!candidates.length) {
    throw new Error(
      `No news results for “${query}”. Try a shorter topic (e.g. “Sonam Wangchuk hunger strike”).`,
    );
  }

  const top = candidates[0] as {
    title: string;
    href: string;
    desc?: string;
    image?: string;
  };
  emitProgress(input.onProgress, "pick", "Top story selected", top.title.slice(0, 100));
  emitProgress(input.onProgress, "open", "Fetching article…", top.href.slice(0, 120));

  let title = top.title;
  let summary =
    top.desc || `Local coverage on ${input.region}: ${top.title}.`;
  let imageUrl: string | null = top.image || null;
  let finalUrl = top.href;

  try {
    const art = await fetch(top.href, {
      headers: {
        Accept: "text/html",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (art.ok) {
      finalUrl = art.url || top.href;
      const body = await art.text();
      const ogTitle = body.match(
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      );
      const ogDesc = body.match(
        /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
      );
      const ogImage = body.match(
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      );
      const metaDesc = body.match(
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
      );
      if (ogTitle?.[1]) title = ogTitle[1].slice(0, 200);
      summary = (ogDesc?.[1] || metaDesc?.[1] || summary).slice(0, 480);
      imageUrl = absUrl(ogImage?.[1] || null, finalUrl);
    }
  } catch {
    /* keep RSS/DDG snippet */
  }

  emitProgress(input.onProgress, "extract", "Story captured");
  const social = await socialPromise.catch((): LocalNewsHit["sources"] => []);
  return {
    title,
    url: finalUrl,
    summary,
    imageUrl,
    sourceHost: hostOf(finalUrl),
    sources: [
      { kind: "news" as const, title, url: finalUrl, snippet: summary.slice(0, 160) },
      ...(social || []),
    ].slice(0, 12),
  };
}

/** Log full stack so production fetch failures can be traced end-to-end. */
function logResearchTrace(stage: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(`[local/research] ${stage}: ${msg}`);
  if (stack) console.error(stack);
  return msg;
}

/**
 * Anakin browser → Anakin Search → HTTP. Each failure is traced, then we continue.
 */
async function researchViaAnakinChain(input: {
  region: string;
  topic: string;
  onProgress?: ResearchProgress;
}): Promise<LocalNewsHit> {
  const { region, topic, onProgress } = input;

  if (hasAnakinCredentials()) {
    try {
      emitProgress(onProgress, "connect", "Trying Anakin browser…");
      const hit = await researchViaAnakin({ region, topic, onProgress });
      return await summarizeHitWithAnakin(hit, onProgress);
    } catch (e) {
      const msg = logResearchTrace("anakin-browser", e);
      emitProgress(
        onProgress,
        "connect",
        "Anakin browser failed — trying Anakin search…",
        msg.slice(0, 100),
      );
    }

    try {
      return await researchViaAnakinSearch({ region, topic, onProgress });
    } catch (e) {
      const msg = logResearchTrace("anakin-search", e);
      emitProgress(
        onProgress,
        "connect",
        "Anakin search failed — HTTP fallback…",
        msg.slice(0, 100),
      );
    }
  } else {
    emitProgress(onProgress, "connect", "No ANAKIN_API_KEY — HTTP fallback…");
  }

  return researchViaHttp({ region, topic, onProgress });
}

/**
 * Local Chrome first (dev only) → Anakin → HTTP.
 * On Vercel/serverless we never launch Chrome — that 500s the whole route.
 */
export async function researchHyperLocalNews(input: {
  region: string;
  topic: string;
  onProgress?: ResearchProgress;
}): Promise<LocalNewsHit> {
  const region = input.region.trim();
  const topic = input.topic.trim();
  if (!region || !topic) {
    throw new Error("Region and local problem / topic are required.");
  }

  const mode = newsBrowserMode();

  // Production / serverless: Anakin Search → HTTP (no Playwright)
  if (mode === "http" || (isServerlessRuntime() && mode !== "local")) {
    emitProgress(
      input.onProgress,
      "connect",
      isServerlessRuntime()
        ? "Cloud scrape (no local Chrome on Vercel)…"
        : "HTTP news scrape…",
    );
    if (hasAnakinCredentials()) {
      try {
        return await researchViaAnakinChain({ region, topic, onProgress: input.onProgress });
      } catch (e) {
        logResearchTrace("serverless-anakin", e);
      }
    }
    return researchViaHttp({ region, topic, onProgress: input.onProgress });
  }

  if (mode === "anakin") {
    return researchViaAnakinChain({ region, topic, onProgress: input.onProgress });
  }

  // Local machine only
  if (!preferLocalBrowser()) {
    return researchViaAnakinChain({ region, topic, onProgress: input.onProgress }).catch(
      async (e) => {
        logResearchTrace("anakin-chain", e);
        return researchViaHttp({ region, topic, onProgress: input.onProgress });
      },
    );
  }

  try {
    const hit = await researchWithVisibleTabs({ region, topic, onProgress: input.onProgress });
    if (localAllowAnakinFallback() && hasAnakinCredentials()) {
      return await summarizeHitWithAnakin(hit, input.onProgress);
    }
    return hit;
  } catch (e) {
    const msg = logResearchTrace("local-browser", e);
    emitProgress(
      input.onProgress,
      "connect",
      "Local crawl failed — falling back…",
      msg.slice(0, 100),
    );

    if (localAllowAnakinFallback()) {
      try {
        return await researchViaAnakinChain({
          region,
          topic,
          onProgress: input.onProgress,
        });
      } catch (chainErr) {
        logResearchTrace("anakin-chain", chainErr);
      }
    }

    emitProgress(input.onProgress, "connect", "Using HTTP fallback…");
    return researchViaHttp({ region, topic, onProgress: input.onProgress });
  }
}

async function researchViaAnakin(input: {
  region: string;
  topic: string;
  onProgress?: ResearchProgress;
}): Promise<LocalNewsHit> {
  const { region, topic, onProgress } = input;
  return withAnakinPage(async (page) => {
    const query = `${region} ${topic}`;
    const url = `https://news.google.com/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
    emitProgress(onProgress, "search", "Searching Google News (Anakin)…", query);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await sleep(1500);
    const candidates = await page.evaluate(() => {
      const out: { title: string; href: string }[] = [];
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const el = a as HTMLAnchorElement;
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        const h = el.href || "";
        if (t.length < 20) continue;
        out.push({ title: t.slice(0, 180), href: h });
        if (out.length >= 8) break;
      }
      return out;
    });
    if (!candidates.length) throw new Error(`No news results for “${query}”.`);
    const top = candidates[0]!;
    emitProgress(onProgress, "pick", "Top story selected", top.title.slice(0, 100));
    await page.goto(top.href, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await sleep(1000);
    const article = await page.evaluate(() => {
      const meta = (sel: string) =>
        document.querySelector(sel)?.getAttribute("content")?.trim() || null;
      return {
        title:
          meta('meta[property="og:title"]') ||
          document.querySelector("h1")?.textContent?.trim() ||
          document.title ||
          "",
        summary:
          meta('meta[property="og:description"]') ||
          meta('meta[name="description"]') ||
          "",
        image: meta('meta[property="og:image"]'),
        finalUrl: location.href,
      };
    });
    return {
      title: (article.title || top.title).slice(0, 200),
      url: article.finalUrl || top.href,
      summary: (article.summary || top.title).slice(0, 480),
      imageUrl: absUrl(article.image, article.finalUrl || top.href),
      sourceHost: hostOf(article.finalUrl || top.href),
      sources: [
        {
          kind: "news" as const,
          title: (article.title || top.title).slice(0, 180),
          url: article.finalUrl || top.href,
          snippet: (article.summary || "").slice(0, 160),
        },
      ],
    };
  }, onProgress);
}
