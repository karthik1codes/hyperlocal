/**
 * Bento createDuel only accepts sports enums — we map Politics/Hyper-Local → Cricket
 * for the API. The scout card UI must keep the real market section label.
 */

export const BENTO_SPORT_CATEGORIES = [
  "Cricket",
  "Football",
  "Basketball",
  "American Football",
  "Tennis",
  "Baseball",
  "Hockey",
  "Formula 1",
] as const;

export type BentoDuelCategory = (typeof BENTO_SPORT_CATEGORIES)[number];

/** @deprecated alias — use BENTO_SPORT_CATEGORIES */
export const BENTO_DUEL_CATEGORIES = BENTO_SPORT_CATEGORIES;

/** True when a label is only a Bento sports-create enum (not a real scoop section). */
export function isBentoSportCategory(raw?: string | null): boolean {
  const s = (raw || "").trim().toLowerCase();
  if (!s) return false;
  return BENTO_SPORT_CATEGORIES.some((c) => c.toLowerCase() === s);
}

/** Pull `Local category: Politics` stashed in descriptions when we mapped for createDuel. */
export function categoryFromDescription(description?: string | null): string | null {
  if (!description) return null;
  const m = description.match(/Local category:\s*([^\n|;]+)/i);
  const cat = m?.[1]?.trim();
  return cat && cat.length >= 2 && cat.length <= 40 && !isBentoSportCategory(cat)
    ? cat
    : null;
}

/** Heuristic section from question / scoop text when category was overwritten to Cricket. */
export function inferCategoryFromText(text?: string | null): string | null {
  const t = (text || "").toLowerCase();
  if (!t.trim()) return null;
  if (
    /politic|government|minister|election|mayor|\bcm\b|governor|assembly|parliament|party|vote|cabinet|mla|mp\b/.test(
      t,
    )
  ) {
    return "Politics";
  }
  if (/transit|metro|bus|train|traffic|road|flyover|airport|rail/.test(t)) return "Transit";
  if (/rain|weather|flood|cyclone|heatwave|monsoon|temperature/.test(t)) return "Weather";
  if (/school|college|university|campus|exam|fee/.test(t)) return "Campus";
  if (/hospital|health|doctor|dengue|covid|clinic/.test(t)) return "Health";
  if (/crime|police|theft|arrest|scam/.test(t)) return "Crime";
  if (/power|electric|water|gas|utility|outage/.test(t)) return "Utilities";
  if (/cricket|football|ipl|match|tournament|fifa|nba|tennis/.test(t)) return null;
  if (/hyper-?local|local news|city|municipal|civic/.test(t)) return "Hyper-Local";
  return null;
}

/**
 * Prefer the real scout section (Politics, Transit, …) over Bento’s sports
 * placeholder (usually Cricket) used only so createDuel accepts the market.
 */
export function preferMarketDisplayCategory(
  preferred?: string | null,
  fallback?: string | null,
  description?: string | null,
): string {
  const fromDesc = categoryFromDescription(description);
  const inferred = inferCategoryFromText(
    `${preferred || ""}\n${fallback || ""}\n${description || ""}`,
  );
  const candidates = [preferred, fromDesc, inferred, fallback]
    .map((c) => (c || "").trim())
    .filter(Boolean);

  for (const c of candidates) {
    if (!isBentoSportCategory(c)) return c;
  }
  // Only show a sport label if the story text looks like sports
  if (
    inferred === null &&
    /cricket|football|ipl|match|tournament|fifa|nba|tennis/.test(
      (description || "").toLowerCase(),
    )
  ) {
    for (const c of candidates) {
      if (isBentoSportCategory(c)) return c;
    }
  }
  return "Hyper-Local";
}
