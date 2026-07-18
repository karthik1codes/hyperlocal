import { ImageResponse } from "next/og";
import { after } from "next/server";
import { scoutCard } from "@/lib/scout";
import { pickFlag } from "@/lib/flagPriority";
import { deEmDash } from "@/lib/text";
import { recordScout } from "@/lib/analytics";
import { loadCardAssets, cardTree } from "@/lib/og/renderCard";
import { loadCardFonts } from "@/lib/og/card";
import type { Card } from "@/lib/scoring/types";

export const runtime = "nodejs";
export const alt = "Bento Cards player card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Per-tier accent for the unfurl (gold reserved; green is the brand).
const TIER_ACCENT: Record<string, string> = {
  bronze: "#cd7f32",
  silver: "#c0c7d0",
  gold: "#e9cc74",
  totw: "#7fa8ff",
  toty: "#7fa8ff",
  icon: "#e9cc74",
};

// Portrait card width inside the 1200×630 unfurl -> ~586 tall, fits with margin.
// Landscape (not the raw portrait) so it also survives Twitter's 1.91:1 crop.
const CARD_W = 386;

const CACHE = { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" };

async function tryCard(username: string): Promise<Card | null> {
  try {
    return await scoutCard(username);
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const raw = await tryCard(username);
  if (raw) after(() => recordScout()); // count link unfurls; flushed after response

  // Not a real profile -> a simple branded "get rated" unfurl.
  if (!raw) {
    const fonts = await loadCardFonts();
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#02001e",
            backgroundImage: "radial-gradient(900px 500px at 50% -10%, rgba(57,211,83,0.16), transparent 60%)",
            color: "#e6edf3",
            fontFamily: "DINPro",
            textAlign: "center",
            padding: 64,
          }}
        >
          <div style={{ display: "flex", color: "#39d353", fontSize: 26, fontWeight: 700, letterSpacing: 4 }}>BENTO × BETTING CARDS</div>
          <div style={{ display: "flex", fontSize: 84, fontWeight: 700, marginTop: 20 }}>@{username}</div>
          <div style={{ display: "flex", fontSize: 34, color: "#a8b3bd", marginTop: 18 }}>Get your market rated out of 99.</div>
          <div style={{ display: "flex", fontSize: 30, color: "#39d353", fontWeight: 700, marginTop: 26 }}>bento.fun</div>
        </div>
      ),
      { ...size, fonts, headers: CACHE },
    );
  }

  const card = { ...raw, country: pickFlag(null, raw.country) ?? "" };
  const accent = TIER_ACCENT[card.finish] ?? "#39d353";
  const geminiArt = card.cardImageUrl?.startsWith("data:image/") ? card.cardImageUrl : null;
  const assets = geminiArt ? null : await loadCardAssets(card, CARD_W);
  const fonts = geminiArt ? await loadCardFonts() : assets!.fonts;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          background: "#02001e",
          backgroundImage:
            "radial-gradient(760px 520px at 22% 12%, rgba(57,211,83,0.14), transparent 60%), radial-gradient(720px 520px at 100% 110%, rgba(212,175,55,0.10), transparent 60%)",
          color: "#e6edf3",
          fontFamily: "DINPro",
          padding: "0 76px",
        }}
      >
        {/* left: Gemini plate or composed FUT card */}
        <div style={{ display: "flex", marginRight: 64 }}>
          {geminiArt ? (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
            <img
              src={geminiArt}
              width={CARD_W}
              height={Math.round(CARD_W * (820 / 540))}
              style={{ objectFit: "contain" }}
            />
          ) : (
            cardTree(card, assets!, CARD_W)
          )}
        </div>

        {/* right: identity + the "why" — the card itself carries rating/stats/flag */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ display: "flex", color: "#39d353", fontSize: 24, fontWeight: 700, letterSpacing: 3 }}>BENTO × HYPER-LOCAL</div>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, marginTop: 14, lineHeight: 1 }}>{card.name}</div>
          <div style={{ display: "flex", marginTop: 20, fontSize: 34, fontWeight: 700 }}>
            <span style={{ display: "flex", color: accent }}>
              {card.overall} {card.finishLabel}
            </span>
            <span style={{ display: "flex", color: "#6e7681", margin: "0 14px" }}>·</span>
            <span style={{ display: "flex", color: "#c9d1d9" }}>{card.archetype}</span>
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "#a8b3bd", marginTop: 22, lineHeight: 1.3, maxWidth: 600 }}>
            {deEmDash(card.archetypeBlurb)}.
          </div>
          <div style={{ display: "flex", fontSize: 26, color: "#6e7681", marginTop: 32 }}>bento.fun/{card.login}</div>
        </div>
      </div>
    ),
    { ...size, fonts, headers: CACHE },
  );
}
