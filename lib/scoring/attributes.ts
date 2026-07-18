import { formatCount } from "../format";
import { STATS } from "./constants";
import type { Metric, Signals, Stats, WorkRateLevel } from "./types";

// FUT-style attributes derived from Bento market signals — no estimation.
// Each deriver returns its value plus a short, plain reason for the UI tooltip.

const Lg = (x: number) => Math.log10(Math.max(0, x) + 1);
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

// A market signal mapped to 0–99, log-scaled against an "elite" reference.
const score99 = (value: number, ref: number) =>
  value <= 0 ? 0 : clamp(Math.round(99 * (Lg(value) / Lg(ref))), 1, 99);

// Skill moves (1–5) = market range: tag/category diversity, +1 for broad options.
export function deriveSkillMoves(s: Signals): { value: number; reason: string } {
  let value = s.languages >= 10 ? 5 : s.languages >= 7 ? 4 : s.languages >= 4 ? 3 : s.languages >= 2 ? 2 : 1;
  const bonus = s.public_repos >= 40 && value < 5;
  if (bonus) value += 1;
  const reason = `Market range: ${s.languages} tag${s.languages === 1 ? "" : "s"}${
    bonus ? ` across ${formatCount(s.public_repos)} related signals` : ""
  }.`;
  return { value, reason };
}

// Weak foot (1–5) = off-side balance: how strong the WEAKER book stats are
// (average of the three lowest), so a one-trick market rates low.
export function deriveWeakFoot(stats: Stats): { value: number; reason: string } {
  const sorted = STATS.map((k) => stats[k]).sort((a, b) => a - b);
  const weakSide = Math.round((sorted[0] + sorted[1] + sorted[2]) / 3);
  const value = weakSide >= 72 ? 5 : weakSide >= 63 ? 4 : weakSide >= 54 ? 3 : weakSide >= 45 ? 2 : 1;
  return { value, reason: `Balance: three weakest book stats average ${weakSide}/99.` };
}

const rate = (v: number): WorkRateLevel => (v >= 68 ? "High" : v >= 50 ? "Med" : "Low");

// Work rate: attack = volume & heat (PAC/SHO), defense = depth (DEF).
export function deriveWorkRate(stats: Stats): { attack: WorkRateLevel; defense: WorkRateLevel; reason: string } {
  const attack = rate(Math.round((stats.pac + stats.sho) / 2));
  const defense = rate(stats.def);
  return {
    attack,
    defense,
    reason: `Attack ${attack} from recent volume & heat; defense ${defense} from depth & balance.`,
  };
}

// Style: a one-word read of recent trading / book activity.
export function deriveStyle(s: Signals): { value: string; reason: string } {
  if (s.recent_spike) return { value: "Explosive", reason: "A sudden burst of stakes well above the usual pace." };
  if (s.active_days_recent >= 200 && s.recent_contributions >= 800)
    return { value: "Relentless", reason: "Heavy book activity across most of the window." };
  if (s.account_age_years >= 6 && s.active_years >= 5)
    return { value: "Controlled", reason: "A long, steady market track record." };
  if (s.max_repo_stars >= 5000 && s.recent_contributions < 200)
    return { value: "Clinical", reason: "One big pool, quiet lately." };
  if (s.recent_contributions >= 300) return { value: "Industrious", reason: "Steady staking through this window." };
  if (s.recent_commits <= 0 && s.prs_to_others <= 0)
    return { value: "Fresh", reason: "New card — metrics will climb as traders place bets." };
  return { value: "Measured", reason: "Light book activity so far." };
}

interface MetricDef {
  label: string;
  unit: string;
  ref: number; // value that maps to ~99
  value: (s: Signals) => number;
}

// Canonical metric display labels — the single source for every surface that
// looks a metric up by label (the scout report renders them; lib/duel reads
// receipts back through them). Renaming here flows everywhere at compile time.
export const METRIC_LABELS = {
  commits: "Recent volume",
  starsEarned: "Total volume",
  topRepoReach: "Top side pool",
  pullRequests: "Traders",
  followers: "Reach",
  languages: "Tags",
  issues: "Balance",
  codeReviews: "Depth",
  contributions: "Lifetime volume",
} as const;

// Core metrics — always shown (a few zeros are fine).
const CORE_METRICS: MetricDef[] = [
  { label: METRIC_LABELS.commits, unit: "units", ref: 3_000, value: (s) => s.recent_commits },
  { label: METRIC_LABELS.starsEarned, unit: "volume", ref: 200_000, value: (s) => s.total_stars_owned },
  { label: METRIC_LABELS.topRepoReach, unit: "pool", ref: 150_000, value: (s) => s.max_repo_stars },
  { label: METRIC_LABELS.pullRequests, unit: "traders", ref: 2_000, value: (s) => s.prs_to_others },
  { label: METRIC_LABELS.followers, unit: "reach", ref: 100_000, value: (s) => s.followers },
  { label: METRIC_LABELS.languages, unit: "tags", ref: 15, value: (s) => s.languages },
  { label: METRIC_LABELS.issues, unit: "pts", ref: 1_500, value: (s) => s.issues_closed },
  { label: METRIC_LABELS.codeReviews, unit: "depth", ref: 2_000, value: (s) => s.reviews },
  { label: METRIC_LABELS.contributions, unit: "volume", ref: 50_000, value: (s) => s.total_contributions_lifetime },
];

// Optional metrics — real clocks when core volume bars are still empty.
const OPTIONAL_METRICS: MetricDef[] = [
  {
    label: "Days live",
    unit: "days",
    ref: 90,
    value: (s) => {
      if (!(s.account_age_years > 0)) return 0;
      return Math.max(1, Math.round(s.account_age_years * 365.25));
    },
  },
  { label: "Active window", unit: "days", ref: 365, value: (s) => s.active_days_recent },
  { label: "Related signals", unit: "sources", ref: 12, value: (s) => s.public_repos },
  { label: "Active seasons", unit: "yrs", ref: 15, value: (s) => s.active_years },
];

const toMetric = (def: MetricDef, s: Signals): Metric => {
  const value = def.value(s);
  return { label: def.label, value, unit: def.unit, score: score99(value, def.ref) };
};

// Detail metrics: the core bars with any ZEROED ones hidden, plus one optional
// (non-zero) filler for every zeroed core metric beyond the first — so a sparse
// profile shows real data (age, active days, repos…) instead of zeros.
export function deriveMetrics(s: Signals): Metric[] {
  const core = CORE_METRICS.map((d) => toMetric(d, s));
  const shown = core.filter((m) => m.value > 0); // hide zeroed core metrics
  const fillerCount = Math.max(0, core.length - shown.length - 1);
  const fillers = OPTIONAL_METRICS.map((d) => toMetric(d, s))
    .filter((m) => m.value > 0)
    .slice(0, fillerCount);
  return [...shown, ...fillers];
}
