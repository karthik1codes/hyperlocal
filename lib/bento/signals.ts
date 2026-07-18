import type { PublicDuelDetail, PublicDuelSummary } from "@bento.fun/sdk";
import type { Signals } from "@/lib/scoring/types";
import type { BentoMarketMeta } from "@/lib/scoring/types";

export type BentoDuel = PublicDuelSummary | PublicDuelDetail;

const AVATAR_FALLBACK =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="%231a1528"/><circle cx="160" cy="140" r="54" fill="%2339d353" fill-opacity="0.35"/><text x="160" y="230" text-anchor="middle" fill="%23fff" font-size="28" font-family="sans-serif">BENTO</text></svg>',
  );

/** Route-safe id: keep alphanumerics, underscore, hyphen. */
export function routeIdForDuel(duelId: string): string {
  return duelId.replace(/[^a-zA-Z0-9_-]/g, "-");
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

/** Book activity → scoring signals (shared by live duels + optimistic stake bumps). */
export type BookActivity = {
  login: string;
  name: string;
  avatarUrl?: string;
  category: string;
  tags?: string[];
  optionsCount?: number;
  /** Staked volume (credits or USDC units from Bento). */
  volume: number;
  participants: number;
  liq0?: number;
  liq1?: number;
  endsIn: number;
  /** Unix seconds */
  createdAt?: number;
};

/**
 * Map book activity into scoring Signals so buildCard() stays unchanged.
 * Zero book → near-zero metrics (new markets score empty until someone bets).
 */
export function signalsFromBook(b: BookActivity): Signals {
  const volume = Math.max(0, Number(b.volume) || 0);
  const participants = Math.max(0, Number(b.participants) || 0);
  const liq0 = Math.max(0, Number(b.liq0) || 0);
  const liq1 = Math.max(0, Number(b.liq1) || 0);
  const totalLiq = liq0 + liq1 || volume;
  const imbalance = totalLiq > 0 ? Math.abs(liq0 - liq1) / totalLiq : 0;
  const endsInDays = Math.max(0, Math.round(Number(b.endsIn || 0) / 86_400));
  const created = Number(b.createdAt ?? Date.now() / 1000);
  const ageYears = Math.max(
    1 / (365.25 * 24),
    (Date.now() / 1000 - created) / (365.25 * 24 * 3600),
  );
  const category = b.category || "Markets";
  const tags = b.tags ?? [];
  const optionsCount = b.optionsCount ?? 2;

  const volScore = score01(volume, 50_000);
  const partScore = score01(participants, 500);
  const liqScore = score01(totalLiq, 25_000);
  const hasBook = volume > 0 || participants > 0 || totalLiq > 0;

  return {
    login: b.login,
    name: clampName(b.name),
    avatarUrl: b.avatarUrl || AVATAR_FALLBACK,
    location: category,
    followers: hasBook ? Math.round(participants * 40 + volScore * 2000) : 0,
    account_age_years: ageYears,
    public_repos: Math.max(optionsCount, optionsCount + tags.length),
    total_stars_owned: hasBook ? Math.round(volume * 8 + liqScore * 4000) : 0,
    max_repo_stars: hasBook ? Math.round(Math.max(liq0, liq1, volume / 2) * 10) : 0,
    languages: Math.max(1, tags.length || (category ? 1 : 0)),
    rankedLanguages: [category, ...tags].filter(Boolean).slice(0, 5),
    topLanguage: category,
    recent_contributions: hasBook ? Math.round(volScore * 4000 + partScore * 800) : 0,
    // Real days until close (not endsInDays * 4)
    active_days_recent: endsInDays > 0 ? endsInDays : Math.max(1, Math.round(ageYears * 365.25)),
    active_years: Math.floor(ageYears),
    total_contributions_lifetime: hasBook
      ? Math.round(volume * 12 + totalLiq * 5 + participants * 10)
      : 0,
    prs_to_others: hasBook ? Math.round(participants * 2 + partScore * 40) : 0,
    reviews: hasBook ? Math.round(totalLiq / 10 + liqScore * 80) : 0,
    issues_closed: hasBook ? Math.round((1 - imbalance) * 40 + 5) : 0,
    recent_commits: hasBook ? Math.round(volScore * 3500 + participants * 15 + volume) : 0,
    recent_spike: participants >= 3 || volume >= 50 || imbalance > 0.65,
  };
}

/** Map a Bento duel into scoring Signals so buildCard() stays unchanged. */
export function signalsFromDuel(d: BentoDuel): Signals {
  const volume = Number(d.totalBetAmountUsdc ?? d.totalBetAmountUSDC ?? d.totalBetAmount ?? 0);
  const participants = Number(d.uniqueParticipants ?? 0);
  const liq0 = Number(d.liquidityBreakdown?.option0?.usdcAmount ?? 0);
  const liq1 = Number(d.liquidityBreakdown?.option1?.usdcAmount ?? 0);
  const title = d.betString || d.options?.[0] || d.duelId;
  const category = d.category || "Markets";

  return signalsFromBook({
    login: routeIdForDuel(d.duelId),
    name: title,
    avatarUrl:
      d.betIcon && String(d.betIcon).startsWith("http") ? String(d.betIcon) : AVATAR_FALLBACK,
    category,
    tags: d.tags ?? [],
    optionsCount: d.options?.length ?? 2,
    volume,
    participants,
    liq0,
    liq1,
    endsIn: Number(d.endsIn ?? 0),
    createdAt: Number(d.createdAt ?? Date.now() / 1000),
  });
}

export function marketMetaFromDuel(d: BentoDuel): BentoMarketMeta {
  const rawType = String(d.duelType || "prediction").toLowerCase();
  return {
    duelId: d.duelId,
    dbId: d.id,
    duelType: rawType === "versus" ? "versus" : "prediction",
    options: d.options?.length ? d.options : ["Yes", "No"],
    collateralMode: d.collateralMode === "usdc" ? "usdc" : "credits",
    totalBetAmountUsdc: Number(d.totalBetAmountUsdc ?? d.totalBetAmountUSDC ?? 0),
    uniqueParticipants: Number(d.uniqueParticipants ?? 0),
    status: Number(d.status ?? 0),
    category: d.category || "Markets",
    description: d.description ?? null,
    endsIn: Number(d.endsIn ?? 0),
    question: d.betString || "",
  };
}
