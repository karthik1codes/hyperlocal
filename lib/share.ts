import type { Card } from "@/lib/scoring/types";

// Share service — a pure module that, given a card, produces the share text and
// per-platform intent URLs. No DOM, no side effects; the React layer wires the
// gestures (native share sheet, window.open). Tested in isolation.

export type SharePlatform = "x" | "linkedin" | "whatsapp";

function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.startsWith("localhost:");
}

function originFromUrl(raw: string | undefined | null): string | null {
  const t = (raw || "").trim().replace(/\/$/, "");
  if (!t) return null;
  try {
    const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    const u = new URL(withProto);
    if (isLoopbackHost(u.host)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Public site origin for share links / JSON-LD.
 * Never emit localhost in shared URLs when a real deploy URL is available —
 * NEXT_PUBLIC_SITE_URL was often unset, so shares baked in http://localhost:3000.
 */
export function siteOrigin(): string {
  const fromEnv = originFromUrl(process.env.NEXT_PUBLIC_SITE_URL);
  if (fromEnv) return fromEnv;

  const fromVercel = originFromUrl(
    process.env.NEXT_PUBLIC_VERCEL_URL ||
      process.env.VERCEL_URL ||
      process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL ||
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
  );
  if (fromVercel) return fromVercel;

  if (typeof window !== "undefined" && window.location?.host) {
    if (!isLoopbackHost(window.location.host)) return window.location.origin;
  }

  // Local-only fallback (tests / pure local share of the running app)
  const loopback = (process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/$/, "");
  if (loopback) return loopback;
  return "http://localhost:3000";
}

/** @deprecated Prefer siteOrigin() — kept for JSON-LD / existing imports. */
export const SITE = siteOrigin();

// Deterministic line per login (FNV-1a) so a given market always gets the same
// brag — leads with the flex, leaves room for the user's own comment.
const lines = (c: Card): string[] => [
  `apparently this market's a ${c.overall}-rated ${c.position}. the odds do numbers.`,
  `${c.finishLabel.toLowerCase()} finish, ${c.overall} overall. locked in on bento.`,
  `pulled a ${c.overall} overall off a bento market. open the books.`,
  `${c.overall} overall ${c.position}, ${c.archetype}. built different, bet different.`,
  `got carded at ${c.overall} overall. the scouts (nobody) are calling.`,
  `turns out a live market makes you a ${c.overall}-rated baller. who knew.`,
];

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

// Encode the displayed flag in the share link so the recipient's card matches
// what the sharer saw (the page re-applies it; an absent/invalid code just
// falls back to the default).
export function cardUrl(card: Card): string {
  const base = `${siteOrigin()}/${card.login}`;
  return card.country ? `${base}?country=${encodeURIComponent(card.country)}` : base;
}

export function shareText(card: Card): string {
  const pool = lines(card);
  return pool[hash(card.login) % pool.length];
}

// Full sentence used as the native-share payload / pre-filled tweet body.
export function shareMessage(card: Card): string {
  return `${shareText(card)}\n\nopen the books →`;
}

// X (Twitter) web-intent composer — the single source for the tweet string.
// Uses /intent/tweet (NOT /intent/post — the latter loops on mobile); carries
// the prefilled body, the url, and the hashtag.
const tweetIntent = (text: string, url: string): string =>
  "https://twitter.com/intent/tweet?text=" +
  encodeURIComponent(text) +
  "&url=" +
  encodeURIComponent(url) +
  "&hashtags=BentoCards";

// Per-platform intent URLs. LinkedIn honors only the url; its preview comes from
// OG tags.
export function intentUrl(platform: SharePlatform, card: Card): string {
  const url = cardUrl(card);
  const text = shareMessage(card);
  switch (platform) {
    case "x":
      return tweetIntent(text, url);
    case "linkedin":
      return (
        "https://www.linkedin.com/sharing/share-offsite/?url=" +
        encodeURIComponent(url)
      );
    case "whatsapp":
      return (
        "https://api.whatsapp.com/send?text=" +
        encodeURIComponent(`${text} ${url}`)
      );
  }
}

// Native Web Share API payload (text + url; file added at call site for IG).
export function nativeSharePayload(card: Card): { title: string; text: string; url: string } {
  return {
    title: "Bento Cards",
    text: shareMessage(card),
    url: cardUrl(card),
  };
}

// Kept for backward-compat with any existing import.
export function shareUrl(card: Card): string {
  return intentUrl("x", card);
}

// ---- Duel sharing ----
// Score-free by design: the fixture poster never spoils the Result, and the
// default share text protects the same click ("full-time score inside").
// Sharers who want to brag the score type it themselves.

export function duelUrl(challenger: string, opponent: string): string {
  return `${siteOrigin()}/${challenger}/vs/${opponent}`;
}

const duelLines = (opponent: string): string[] => [
  `just dragged @${opponent} onto the pitch. full-time score inside.`,
  `me vs @${opponent}, settled on market cards. someone got cooked.`,
  `called out @${opponent} for a duel. the scoreline does the talking.`,
  `six stats, no VAR. me vs @${opponent} — result inside.`,
];

export function duelShareMessage(challenger: string, opponent: string): string {
  const pool = duelLines(opponent);
  return `${pool[hash(`${challenger}/${opponent}`) % pool.length]}\n\nwatch the duel →`;
}

export function duelIntentUrl(challenger: string, opponent: string): string {
  return tweetIntent(duelShareMessage(challenger, opponent), duelUrl(challenger, opponent));
}

export function duelSharePayload(
  challenger: string,
  opponent: string,
): { title: string; text: string; url: string } {
  return {
    title: "Bento Duel",
    text: duelShareMessage(challenger, opponent),
    url: duelUrl(challenger, opponent),
  };
}
