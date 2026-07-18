import { formatCount } from "../format";
import type { Playstyle, Signals } from "./types";

// Bento market "playstyles". Each fires when its signal crosses `base`;
// `plus` marks the elite "PlayStyle+" tier.
interface PlaystyleDef {
  name: string;
  icon: string;
  noun: string;
  value: (s: Signals) => number;
  base: number;
  plus: number;
}

const CATALOG: PlaystyleDef[] = [
  { name: "Volume Magnet", icon: "star", noun: "total volume", value: (s) => s.total_stars_owned, base: 500, plus: 20_000 },
  { name: "Whale Pool", icon: "flame", noun: "top-side pool", value: (s) => s.max_repo_stars, base: 1_000, plus: 20_000 },
  { name: "Always Open", icon: "zap", noun: "active days", value: (s) => s.active_days_recent, base: 120, plus: 250 },
  { name: "Hot Tape", icon: "fast-forward", noun: "recent activity", value: (s) => s.recent_contributions, base: 500, plus: 2_500 },
  { name: "Marathoner", icon: "infinity", noun: "lifetime volume", value: (s) => s.total_contributions_lifetime, base: 3_000, plus: 25_000 },
  { name: "Deep Book", icon: "shield", noun: "depth & balance", value: (s) => s.reviews + s.issues_closed, base: 30, plus: 300 },
  { name: "Crowd Pull", icon: "git-pull-request", noun: "traders", value: (s) => s.prs_to_others, base: 30, plus: 400 },
  { name: "Magnetic", icon: "users", noun: "reach", value: (s) => s.followers, base: 200, plus: 20_000 },
  { name: "Multi-tag", icon: "languages", noun: "tags", value: (s) => s.languages, base: 5, plus: 9 },
  { name: "Wide Book", icon: "folder-git", noun: "related signals", value: (s) => s.public_repos, base: 30, plus: 150 },
  { name: "Veteran Book", icon: "clock", noun: "years live", value: (s) => s.account_age_years, base: 5, plus: 12 },
];

const MAX_SHOWN = 8;

export function derivePlaystyles(s: Signals): Playstyle[] {
  return CATALOG.map((def) => ({ def, val: def.value(s) }))
    .filter(({ def, val }) => val >= def.base)
    .sort((a, b) => {
      const ap = a.val >= a.def.plus;
      const bp = b.val >= b.def.plus;
      if (ap !== bp) return ap ? -1 : 1;
      return b.val / b.def.base - a.val / a.def.base;
    })
    .slice(0, MAX_SHOWN)
    .map(({ def, val }) => ({
      name: def.name,
      icon: def.icon,
      plus: val >= def.plus,
      reason: `${formatCount(val)} ${def.noun}${val >= def.plus ? " — elite tier" : ""}.`,
    }));
}
