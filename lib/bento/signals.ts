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

/** Map a Bento duel into scoring Signals so buildCard() stays unchanged. */
export function signalsFromDuel(d: BentoDuel): Signals {
  const volume = Number(d.totalBetAmountUsdc ?? d.totalBetAmountUSDC ?? d.totalBetAmount ?? 0);
  const participants = Number(d.uniqueParticipants ?? 0);
  const liq0 = Number(d.liquidityBreakdown?.option0?.usdcAmount ?? 0);
  const liq1 = Number(d.liquidityBreakdown?.option1?.usdcAmount ?? 0);
  const totalLiq = liq0 + liq1;
  const imbalance = totalLiq > 0 ? Math.abs(liq0 - liq1) / totalLiq : 0;
  const endsInDays = Math.max(1, Math.round(Number(d.endsIn ?? 0) / 86_400) || 14);
  const created = Number(d.createdAt ?? Date.now() / 1000);
  const ageYears = Math.max(0.05, (Date.now() / 1000 - created) / (365.25 * 24 * 3600));
  const login = routeIdForDuel(d.duelId);
  const title = d.betString || d.options?.[0] || d.duelId;
  const category = d.category || "Markets";

  // Scale market activity into the ranges the scoring engine expects.
  const volScore = score01(volume, 50_000);
  const partScore = score01(participants, 500);
  const liqScore = score01(totalLiq, 25_000);

  return {
    login,
    name: clampName(title),
    avatarUrl: (d.betIcon && String(d.betIcon).startsWith("http") ? d.betIcon : AVATAR_FALLBACK) as string,
    location: category,
    followers: Math.round(participants * 40 + volScore * 2000),
    account_age_years: ageYears,
    public_repos: Math.max(2, (d.options?.length ?? 2) + (d.tags?.length ?? 0)),
    total_stars_owned: Math.round(volume * 8 + liqScore * 4000),
    max_repo_stars: Math.round(Math.max(liq0, liq1) * 10 + 50),
    languages: Math.min(20, Math.max(1, (d.tags?.length ?? 0) + 1)),
    rankedLanguages: [category, ...(d.tags ?? [])].filter(Boolean).slice(0, 5),
    topLanguage: category,
    recent_contributions: Math.round(volScore * 4000 + partScore * 800),
    active_days_recent: Math.min(365, endsInDays * 4),
    active_years: Math.max(1, Math.round(ageYears) || 1),
    total_contributions_lifetime: Math.round(volume * 12 + totalLiq * 5 + 100),
    prs_to_others: Math.round(participants * 2 + partScore * 40),
    reviews: Math.round(totalLiq / 10 + liqScore * 80),
    issues_closed: Math.round((1 - imbalance) * 40 + 5),
    recent_commits: Math.round(volScore * 3500 + 80),
    recent_spike: participants > 40 || volume > 5_000 || imbalance > 0.65,
  };
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
