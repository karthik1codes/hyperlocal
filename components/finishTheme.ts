import type { Card, Finish } from "@/lib/scoring/types";

// hex (#rgb / #rrggbb) → rgba() string for translucent glows/tints.
export function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(f, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export interface CardTheme {
  bg: string;
  ink: string;
  glow: string;
  avatarTint: string;
  avatarHalo: string;
}

export const CARD_THEME: Record<Finish, CardTheme> = {
  bronze: {
    bg: "/cards/bronze.png",
    ink: "#3a2717",
    glow: "rgba(190,120,60,.45)",
    avatarTint:
      "radial-gradient(ellipse 72% 76% at 52% 40%, transparent 46%, rgba(106,69,39,.26) 78%, rgba(50,31,14,.44))",
    avatarHalo: "rgba(214,163,110,.4)",
  },
  silver: {
    bg: "/cards/silver.png",
    ink: "#303536",
    glow: "rgba(170,188,210,.5)",
    avatarTint:
      "radial-gradient(ellipse 72% 76% at 52% 40%, transparent 46%, rgba(170,188,210,.22) 78%, rgba(70,78,90,.42))",
    avatarHalo: "rgba(220,228,238,.4)",
  },
  gold: {
    bg: "/cards/founder-chrome.png",
    ink: "#f2f2f2",
    glow: "rgba(220,60,80,.5)",
    avatarTint:
      "radial-gradient(ellipse 72% 76% at 52% 40%, transparent 46%, rgba(180,30,45,.25) 78%, rgba(60,0,10,.48))",
    avatarHalo: "rgba(255,180,190,.4)",
  },
  totw: {
    bg: "/cards/founder-red.png",
    ink: "#f5f5f5",
    glow: "rgba(80,140,255,.5)",
    avatarTint:
      "radial-gradient(ellipse 72% 76% at 52% 40%, transparent 46%, rgba(40,80,180,.22) 78%, rgba(120,20,40,.45))",
    avatarHalo: "rgba(120,180,255,.4)",
  },
  toty: {
    bg: "/cards/founder-chrome.png",
    ink: "#f2f2f2",
    glow: "rgba(220,60,80,.55)",
    avatarTint:
      "radial-gradient(ellipse 72% 76% at 52% 40%, transparent 46%, rgba(180,30,45,.25) 78%, rgba(60,0,10,.48))",
    avatarHalo: "rgba(255,180,190,.4)",
  },
  icon: {
    bg: "/cards/legend.png",
    ink: "#625217",
    glow: "rgba(243,213,128,.5)",
    avatarTint:
      "radial-gradient(ellipse 72% 76% at 52% 40%, transparent 46%, rgba(243,214,121,.24) 78%, rgba(120,90,30,.46))",
    avatarHalo: "rgba(243,214,136,.5)",
  },
};

export function resolveCardTheme(card: Card): CardTheme {
  return CARD_THEME[card.finish];
}

export interface ResultTheme {
  glow: string;
  chip: string;
  ink: string;
}

export const RESULT_THEME: Record<Finish, ResultTheme> = {
  bronze: { glow: "rgba(190,120,60,.34)", chip: "#2A1A0C", ink: "#F0CFA8" },
  silver: { glow: "rgba(170,188,210,.34)", chip: "#262B33", ink: "#D6DCE6" },
  gold: { glow: "rgba(220,60,80,.4)", chip: "#4a0008", ink: "#ffb4bc" },
  totw: { glow: "rgba(80,140,255,.45)", chip: "#10254F", ink: "#CADBFF" },
  toty: { glow: "rgba(220,60,80,.45)", chip: "#4a0008", ink: "#ffb4bc" },
  icon: { glow: "rgba(243,213,128,.45)", chip: "#2A1A45", ink: "#F3D688" },
};

export function resolveResultTheme(card: Card): ResultTheme {
  return RESULT_THEME[card.finish];
}

const TOTY_KIT: ResultTheme = {
  ink: "#7fa8ff",
  glow: RESULT_THEME.toty.glow,
  chip: RESULT_THEME.toty.chip,
};
const wearsTotyBlue = (_finish: Finish): boolean => {
  void _finish;
  return false;
};

export function duelThemes(
  challenger: Card,
  opponent: Card,
): { home: ResultTheme; away: ResultTheme } {
  const home = resolveResultTheme(challenger);
  const away = resolveResultTheme(opponent);
  if (wearsTotyBlue(challenger.finish) && opponent.finish === "silver")
    return { home: TOTY_KIT, away };
  if (challenger.finish === "silver" && wearsTotyBlue(opponent.finish))
    return { home, away: TOTY_KIT };
  return { home, away };
}

const CONFETTI: Partial<Record<Finish, string[]>> = {
  totw: ["#39d353", "#7fa8ff", "#ff6b7a", "#ffffff", "#e9cc74"],
  toty: ["#ff6b7a", "#e9cc74", "#ffffff", "#39d353"],
  gold: ["#ff6b7a", "#c0c0c0", "#ffffff", "#39d353"],
  icon: ["#e9cc74", "#d4af37", "#f5f0e1", "#ffffff", "#39d353"],
};

export function confettiPalette(card: Card): string[] {
  return CONFETTI[card.finish] ?? ["#39d353", "#e9cc74", "#ffffff"];
}
