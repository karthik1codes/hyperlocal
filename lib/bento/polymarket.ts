import "server-only";
import { buildCard } from "@/lib/scoring/engine";
import type { Card, Signals, BentoMarketMeta } from "@/lib/scoring/types";
import { bentoBaseUrl, bentoBuilderHeaders } from "./config";
import type { ScoutError } from "./client";

/** Direct Gamma — preferred when the machine can reach Polymarket. */
const GAMMA_EVENTS = "https://gamma-api.polymarket.com/events";

/**
 * Bento's Polymarket proxy lives on the public markets host (testnet), not the
 * SDK/internal API host. Prefer testnet; only derive proxy paths from BENTO_URL
 * when it already looks like a markets/api host.
 */
function bentoProxyCandidates(): string[] {
  const urls = new Set<string>();
  urls.add("https://testnet.bento.fun/api/proxy/polymarket/gamma/events");

  const base = bentoBaseUrl().replace(/\/$/, "");
  const isInternalSdk = /internal-server\.bento\.fun/i.test(base);
  if (!isInternalSdk) {
    if (base.endsWith("/api")) {
      urls.add(`${base}/proxy/polymarket/gamma/events`);
    } else if (/bento\.fun/i.test(base)) {
      urls.add(`${base}/api/proxy/polymarket/gamma/events`);
    }
  }
  return [...urls];
}

function fetchErrMessage(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = e.cause as { code?: string; message?: string } | undefined;
  if (cause?.code) return `${e.message} (${cause.code})`;
  if (cause?.message) return `${e.message} (${cause.message})`;
  return e.message;
}

/**
 * Leagues for the home fan.
 * FIFA World Cup 2026 tag_id = 102232 (slug fifa-world-cup).
 * Fetch larger windows for FIFA because volume leaders are mostly props
 * (exact score / more markets), not moneylines.
 */
const LEAGUES = [
  {
    key: "fifa",
    label: "FIFA",
    tagId: 102232,
    tagSlugs: ["fifa-world-cup"],
    pageSize: 25,
    maxPages: 4,
  },
  {
    key: "epl",
    label: "EPL",
    tagId: null as number | null,
    tagSlugs: ["epl", "premier-league"],
    pageSize: 20,
    maxPages: 2,
  },
  {
    key: "ucl",
    label: "UCL",
    tagId: 1234,
    tagSlugs: ["ucl", "champions-league"],
    pageSize: 20,
    maxPages: 2,
  },
] as const;

/** Tag slugs we accept when validating a match event. */
const FOOTBALL_TAG_SLUGS = new Set([
  "fifa-world-cup",
  "epl",
  "premier-league",
  "ucl",
  "champions-league",
  "soccer",
]);

const LEAGUE_LABEL: Record<string, string> = {
  "fifa-world-cup": "FIFA",
  epl: "EPL",
  "premier-league": "EPL",
  ucl: "UCL",
  "champions-league": "UCL",
};

type GammaTag = { id?: string | number; slug?: string; label?: string };
type GammaMarket = {
  id?: string;
  question?: string;
  conditionId?: string;
  marketMakerAddress?: string;
  outcomes?: string;
  outcomePrices?: string;
  volume?: string | number;
  volume24hr?: number;
  liquidity?: string | number;
  sportsMarketType?: string;
  groupItemTitle?: string;
  active?: boolean;
  closed?: boolean;
};
type GammaEvent = {
  id?: string;
  title?: string;
  slug?: string;
  description?: string;
  image?: string;
  icon?: string;
  volume?: number;
  volume24hr?: number;
  liquidity?: number;
  startTime?: string;
  endDate?: string;
  closed?: boolean;
  tags?: GammaTag[];
  markets?: GammaMarket[];
  sport?: { sport?: string };
};

function parseJsonArray(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function leagueFromTags(tags: GammaTag[] | undefined): string {
  for (const t of tags ?? []) {
    const slug = (t.slug || "").toLowerCase();
    if (LEAGUE_LABEL[slug]) return LEAGUE_LABEL[slug];
  }
  return "Football";
}

function hasFootballTag(tags: GammaTag[] | undefined): boolean {
  return (tags ?? []).some((t) => FOOTBALL_TAG_SLUGS.has((t.slug || "").toLowerCase()));
}

/** True for moneyline match pages — not exact-score / props / futures. */
function isMatchEvent(e: GammaEvent): boolean {
  const title = e.title || "";
  const slug = (e.slug || "").toLowerCase();
  if (/exact score|more markets|player props|total corners|total cards/i.test(title)) {
    return false;
  }
  if (/exact-score|more-markets|player-props/.test(slug)) return false;
  // FIFA match pages: fifwc-esp-arg-2026-07-19 (no prop suffix)
  const fifaMatchSlug = /^fifwc-[a-z0-9]+-[a-z0-9]+-\d{4}-\d{2}-\d{2}$/i.test(slug);
  const titledMatch = /vs\.?/i.test(title);
  if (!fifaMatchSlug && !titledMatch) return false;
  return fifaMatchSlug || hasFootballTag(e.tags);
}

/** Props / futures / long-dated markets — same bucket as Markets → “Props + Futures”. */
function isPropsOrFuturesEvent(e: GammaEvent): boolean {
  if (!e.slug || e.closed) return false;
  const title = e.title || "";
  const slug = (e.slug || "").toLowerCase();
  const tags = (e.tags ?? []).map((t) => (t.slug || "").toLowerCase());

  // Explicit prop / futures style titles
  if (
    /exact score|more markets|player props|winner|champion|mvp|futures?|outright/i.test(
      title,
    )
  ) {
    return true;
  }
  if (/exact-score|more-markets|player-props|winner|champion/.test(slug)) return true;

  const markets = e.markets ?? [];
  const types = markets.map((m) => String(m.sportsMarketType || "").toLowerCase());
  if (
    types.some((t) =>
      /prop|spread|total|exact|futures|outright|nrfi|saves|first_set|extra_time|penalty/i.test(
        t,
      ),
    )
  ) {
    return true;
  }

  // High-volume non-moneyline sports events (World Cup Winner, NBA champ, …)
  if (tags.includes("sports") && !isMatchEvent(e)) return true;

  // Binary / multi markets with volume but not a live moneyline match
  const active = markets.filter((m) => m.active !== false && !m.closed && m.conditionId);
  if (active.length >= 1 && !moneylineMarkets(e).length && Number(e.volume24hr ?? e.volume ?? 0) > 0) {
    return true;
  }

  return false;
}

function allTradeableMarkets(e: GammaEvent): GammaMarket[] {
  return (e.markets ?? []).filter(
    (m) => m.active !== false && !m.closed && Boolean(m.conditionId),
  );
}

function moneylineMarkets(e: GammaEvent): GammaMarket[] {
  return (e.markets ?? []).filter(
    (m) =>
      m.active !== false &&
      !m.closed &&
      String(m.sportsMarketType || "").toLowerCase() === "moneyline" &&
      Boolean(m.conditionId),
  );
}

function pickPrimaryMarket(legs: GammaMarket[]): GammaMarket | null {
  if (!legs.length) return null;
  return [...legs].sort(
    (a, b) => Number(b.volume24hr ?? 0) - Number(a.volume24hr ?? 0),
  )[0];
}

function routeLogin(slug: string): string {
  const clean = slug.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);
  return `pm-${clean}`;
}

export function isPolymarketLogin(login: string): boolean {
  return login.trim().toLowerCase().startsWith("pm-");
}

function clampName(s: string, max = 18): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function score01(n: number, softCap: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(1, n / softCap);
}

function signalsFromEvent(e: GammaEvent, primary: GammaMarket, legs: GammaMarket[]): Signals {
  const volume = Number(e.volume24hr ?? e.volume ?? primary.volume24hr ?? primary.volume ?? 0);
  const liq = Number(e.liquidity ?? primary.liquidity ?? 0);
  const league = leagueFromTags(e.tags);
  const login = routeLogin(e.slug || primary.conditionId || e.id || "market");
  const participants = Math.max(2, Math.round(Math.sqrt(Math.max(volume, 1)) / 8));
  const volScore = score01(volume, 2_000_000);
  const liqScore = score01(liq, 500_000);
  const endsInDays = 3;

  return {
    login,
    name: clampName(e.title || primary.question || "Match"),
    avatarUrl:
      (e.image && e.image.startsWith("http") && e.image) ||
      (e.icon && e.icon.startsWith("http") && e.icon) ||
      "",
    location: league,
    followers: Math.round(participants * 40 + volScore * 2000),
    account_age_years: 0.2,
    public_repos: Math.max(2, legs.length + 1),
    total_stars_owned: Math.round(volume / 10 + liqScore * 4000),
    max_repo_stars: Math.round(volume / 20 + 50),
    languages: Math.min(8, 1 + (e.tags?.length ?? 0)),
    rankedLanguages: [league, "Soccer", "Polymarket"].filter(Boolean),
    topLanguage: league,
    recent_contributions: Math.round(volScore * 4000 + 200),
    active_days_recent: Math.min(365, endsInDays * 20),
    active_years: 1,
    total_contributions_lifetime: Math.round(volume / 8 + 100),
    prs_to_others: Math.round(participants * 2),
    reviews: Math.round(liq / 50 + 20),
    issues_closed: 20,
    recent_commits: Math.round(volScore * 3500 + 80),
    recent_spike: volume > 100_000,
  };
}

function marketMetaFromEvent(
  e: GammaEvent,
  primary: GammaMarket,
  legs: GammaMarket[],
  kind: "match" | "props_futures" = "match",
): BentoMarketMeta {
  const slug = e.slug || "";
  const login = routeLogin(slug || primary.conditionId || "market");
  const outcomeAddresses = legs.map((m) => ({
    label: (m.groupItemTitle || m.question || "Outcome").replace(/\s*\(.*\)\s*$/, "").trim(),
    conditionId: m.conditionId!,
  }));
  const fromOutcomes = parseJsonArray(primary.outcomes);
  const options =
    outcomeAddresses.length >= 2
      ? outcomeAddresses.slice(0, 2).map((o) => o.label)
      : fromOutcomes.length >= 2
        ? fromOutcomes.slice(0, 2)
        : ["Yes", "No"];

  const volume = Number(e.volume24hr ?? e.volume ?? primary.volume24hr ?? 0);
  const category =
    kind === "props_futures"
      ? /winner|champion|outright|futures?/i.test(e.title || "")
        ? "Futures"
        : "Props"
      : leagueFromTags(e.tags);

  return {
    duelId: login,
    dbId: String(e.id || primary.id || login),
    duelType: "prediction",
    options,
    collateralMode: "usdc",
    totalBetAmountUsdc: volume,
    uniqueParticipants: Math.max(2, Math.round(Math.sqrt(Math.max(volume, 1)) / 8)),
    status: 1,
    category,
    description: e.description || primary.question || null,
    endsIn: 86_400 * 2,
    question: e.title || primary.question || "",
    source: "polymarket",
    conditionId: primary.conditionId || null,
    marketMakerAddress: primary.marketMakerAddress || null,
    slug,
    externalUrl: "https://testnet.bento.fun/markets",
    outcomeAddresses,
  };
}

export function cardFromPolymarketEvent(
  e: GammaEvent,
  kind: "match" | "props_futures" = "match",
): Card | null {
  const legs =
    kind === "match" ? moneylineMarkets(e) : allTradeableMarkets(e);
  const primary = pickPrimaryMarket(legs.length ? legs : allTradeableMarkets(e));
  if (!primary?.conditionId || !e.slug) return null;
  const signals = signalsFromEvent(e, primary, legs.length ? legs : [primary]);
  if (kind === "props_futures") {
    signals.location =
      /winner|champion|outright|futures?/i.test(e.title || "") ? "Futures" : "Props";
    signals.rankedLanguages = [signals.location, "Polymarket", "Bento"];
    signals.topLanguage = signals.location;
  }
  if (!signals.avatarUrl) {
    signals.avatarUrl =
      "data:image/svg+xml;utf8," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="#12101c"/><text x="160" y="170" text-anchor="middle" fill="#39d353" font-size="48" font-family="sans-serif">PM</text></svg>',
      );
  }
  const card = buildCard(signals);
  return {
    ...card,
    market: marketMetaFromEvent(e, primary, legs.length ? legs : [primary], kind),
  };
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

const RETRYABLE = new Set([502, 503, 504]);

async function fetchJsonArray(url: string, headers?: HeadersInit): Promise<GammaEvent[]> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: headers ?? { Accept: "application/json" },
      });
      if (res.ok) {
        const data = (await res.json()) as unknown;
        return Array.isArray(data) ? (data as GammaEvent[]) : [];
      }
      lastErr = new Error(`HTTP ${res.status}`);
      if (!RETRYABLE.has(res.status)) break;
      await sleep(250 * (attempt + 1));
    } catch (e) {
      lastErr = new Error(fetchErrMessage(e));
      await sleep(250 * (attempt + 1));
    }
  }
  throw lastErr ?? new Error("fetch failed");
}

function eventsQuery(params: Record<string, string | number | boolean>): string {
  const u = new URL(GAMMA_EVENTS);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}

/** Same volume feed the Markets → Props + Futures tab uses (no tag filter). */
async function fetchVolumeEventsPage(limit: number, offset = 0): Promise<GammaEvent[]> {
  const params = {
    active: true,
    closed: false,
    limit,
    offset,
    order: "volume24hr",
    ascending: false,
  } as const;

  // Prefer Bento testnet proxy — matches https://testnet.bento.fun/markets
  const headers = bentoBuilderHeaders();
  for (const base of bentoProxyCandidates()) {
    const url = new URL(base);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    url.searchParams.set("archived", "false");
    try {
      const rows = await fetchJsonArray(url.toString(), headers);
      if (rows.length) return rows;
    } catch (e) {
      console.warn(`[polymarket] volume @ ${url.host}: ${fetchErrMessage(e)}`);
    }
  }

  try {
    return await fetchJsonArray(eventsQuery(params));
  } catch (e) {
    console.warn(`[polymarket] gamma volume: ${fetchErrMessage(e)}`);
    return [];
  }
}

/** Fetch one page from Gamma (preferred) or Bento proxy. */
async function fetchEventsPage(opts: {
  tagId?: number | null;
  tagSlug?: string;
  limit: number;
  offset?: number;
}): Promise<GammaEvent[]> {
  const { tagId, tagSlug, limit, offset = 0 } = opts;

  // 1) Direct Gamma with tag_id (reliable for FIFA).
  if (tagId != null) {
    try {
      return await fetchJsonArray(
        eventsQuery({
          tag_id: tagId,
          active: true,
          closed: false,
          limit,
          offset,
          order: "volume24hr",
          ascending: false,
        }),
      );
    } catch (e) {
      console.warn(`[polymarket] gamma tag_id=${tagId}: ${fetchErrMessage(e)}`);
    }
  }

  // 2) Direct Gamma with tag_slug.
  if (tagSlug) {
    try {
      return await fetchJsonArray(
        eventsQuery({
          tag_slug: tagSlug,
          active: true,
          closed: false,
          limit,
          offset,
          order: "volume24hr",
          ascending: false,
        }),
      );
    } catch (e) {
      console.warn(`[polymarket] gamma tag_slug=${tagSlug}: ${fetchErrMessage(e)}`);
    }
  }

  // 3) Bento proxy (needs builder key) — last resort; keep pages tiny to avoid 502.
  if (!tagSlug) return [];
  const headers = bentoBuilderHeaders();
  const proxyLimit = Math.min(limit, 8);
  for (const base of bentoProxyCandidates()) {
    const url = new URL(base);
    url.searchParams.set("tag_slug", tagSlug);
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("archived", "false");
    url.searchParams.set("limit", String(proxyLimit));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("order", "volume24hr");
    url.searchParams.set("ascending", "false");
    try {
      return await fetchJsonArray(url.toString(), headers);
    } catch (e) {
      const host = url.host + url.pathname;
      console.warn(`[polymarket] bento ${tagSlug} @ ${host}: ${fetchErrMessage(e)}`);
    }
  }
  return [];
}

/** Paginate a league until we have enough moneyline match events. */
async function listLeagueMatchEvents(
  league: (typeof LEAGUES)[number],
  want: number,
): Promise<GammaEvent[]> {
  const found: GammaEvent[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < league.maxPages && found.length < want; page++) {
    const rows = await fetchEventsPage({
      tagId: league.tagId,
      tagSlug: league.tagSlugs[0],
      limit: league.pageSize,
      offset: page * league.pageSize,
    });
    if (!rows.length) {
      // Try alias slug once if first page empty.
      if (page === 0 && league.tagSlugs[1]) {
        const alt = await fetchEventsPage({
          tagSlug: league.tagSlugs[1],
          limit: league.pageSize,
          offset: 0,
        });
        for (const e of alt) {
          if (!isMatchEvent(e) || !e.slug || seen.has(e.slug)) continue;
          if (!moneylineMarkets(e).length) continue;
          seen.add(e.slug);
          found.push(e);
        }
      }
      break;
    }

    for (const e of rows) {
      if (!isMatchEvent(e) || !e.slug || seen.has(e.slug)) continue;
      if (!moneylineMarkets(e).length) continue;
      seen.add(e.slug);
      found.push(e);
      if (found.length >= want) break;
    }
  }

  return found;
}

async function fetchEventBySlug(slug: string): Promise<GammaEvent | null> {
  // Direct Gamma first.
  try {
    const rows = await fetchJsonArray(
      eventsQuery({ slug, active: true, closed: false, limit: 5 }),
    );
    if (rows[0]) return rows[0];
  } catch {
    /* fall through */
  }

  const headers = bentoBuilderHeaders();
  for (const base of bentoProxyCandidates()) {
    const url = new URL(base);
    url.searchParams.set("slug", slug);
    try {
      const rows = await fetchJsonArray(url.toString(), headers);
      if (rows[0]) return rows[0];
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Markets → Props + Futures tab on https://testnet.bento.fun/markets
 * Volume-ranked Polymarket events excluding live moneyline match pages.
 */
export async function listPropsAndFuturesCards(limit = 8): Promise<Card[]> {
  const want = Math.max(limit * 3, 24);
  const found: GammaEvent[] = [];
  const seen = new Set<string>();
  const pageSize = 20;

  for (let page = 0; page < 4 && found.length < want; page++) {
    const rows = await fetchVolumeEventsPage(pageSize, page * pageSize);
    if (!rows.length) break;
    for (const e of rows) {
      if (!e.slug || seen.has(e.slug)) continue;
      if (!isPropsOrFuturesEvent(e)) continue;
      if (!allTradeableMarkets(e).length) continue;
      seen.add(e.slug);
      found.push(e);
      if (found.length >= want) break;
    }
  }

  found.sort(
    (a, b) => Number(b.volume24hr ?? b.volume ?? 0) - Number(a.volume24hr ?? a.volume ?? 0),
  );

  const cards: Card[] = [];
  for (const e of found) {
    const card = cardFromPolymarketEvent(e, "props_futures");
    if (!card) continue;
    cards.push(card);
    if (cards.length >= limit) break;
  }
  return cards;
}

/**
 * Home fan: FIFA / EPL / UCL moneyline matches.
 * Interleaves leagues so FIFA isn't buried under props noise.
 */
export async function listFootballCards(limit = 8): Promise<Card[]> {
  const perLeague = Math.max(3, Math.ceil(limit / LEAGUES.length) + 2);

  const batches = await Promise.all(
    LEAGUES.map(async (league) => {
      try {
        const events = await listLeagueMatchEvents(league, perLeague);
        return { league, events };
      } catch (e) {
        console.warn(`[polymarket] ${league.key}: ${(e as Error).message}`);
        return { league, events: [] as GammaEvent[] };
      }
    }),
  );

  // Round-robin so FIFA/EPL/UCL all show up.
  const queues = batches.map((b) =>
    [...b.events].sort(
      (a, c) => Number(c.volume24hr ?? c.volume ?? 0) - Number(a.volume24hr ?? a.volume ?? 0),
    ),
  );

  const cards: Card[] = [];
  const used = new Set<string>();
  let added = true;
  while (cards.length < limit && added) {
    added = false;
    for (const q of queues) {
      while (q.length) {
        const e = q.shift()!;
        if (!e.slug || used.has(e.slug)) continue;
        const card = cardFromPolymarketEvent(e);
        if (!card) continue;
        used.add(e.slug);
        cards.push(card);
        added = true;
        break;
      }
      if (cards.length >= limit) break;
    }
  }

  return cards;
}

export async function fetchFootballCard(loginRaw: string): Promise<Card> {
  const login = loginRaw.trim().replace(/^@/, "").toLowerCase();
  if (!isPolymarketLogin(login)) {
    const err: ScoutError = { type: "invalid", message: `"${loginRaw}" isn't a Polymarket match id.` };
    throw err;
  }
  const slug = login.slice(3);
  const event = await fetchEventBySlug(slug);
  if (!event) {
    const err: ScoutError = {
      type: "notfound",
      message: `There's no market named ${loginRaw}.`,
    };
    throw err;
  }

  const kind =
    isMatchEvent(event) && moneylineMarkets(event).length
      ? ("match" as const)
      : ("props_futures" as const);

  const card = cardFromPolymarketEvent(event, kind);
  if (!card) {
    const err: ScoutError = {
      type: "notfound",
      message: `No tradeable market for ${loginRaw}.`,
    };
    throw err;
  }
  return card;
}
