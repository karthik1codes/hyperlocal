"use client";

import { memo, type CSSProperties } from "react";
import type { Card, StatKey } from "@/lib/scoring/types";
import { languageLogoUrl } from "@/lib/languages";
import { cardDisplayName } from "@/lib/text";
import { cardAvatarSrc } from "@/lib/media/avatarSrc";
import { resolveCardTheme } from "./finishTheme";

const AVATAR_FALLBACK =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="%23000" fill-opacity="0"/><circle cx="160" cy="128" r="62" fill="%23ffffff" fill-opacity="0.18"/><rect x="58" y="206" width="204" height="150" rx="80" fill="%23ffffff" fill-opacity="0.18"/></svg>',
  );

const FONT_MEDIUM = "var(--font-din-medium), 'Saira Condensed', sans-serif";
const FONT_COND = "var(--font-din-cond), 'Saira Condensed', sans-serif";
const FONT_BOLD = "var(--font-din-bold), 'Saira Condensed', sans-serif";

const AVATAR_MASK_FEATHER =
  "radial-gradient(ellipse 66% 88% at 52% 40%, #000 56%, transparent 80%)";
const AVATAR_MASK_BOTTOM_FADE =
  "linear-gradient(220deg, #000 70%, transparent 100%)";
const AVATAR_MASK_TOP_FADE = "linear-gradient(180deg, transparent 1%, #000 22%)";

const pad2 = (n: number) => String(Math.round(n)).padStart(2, "0");

const STAT_CELLS: {
  k: StatKey;
  l: string;
  vx: number;
  lx: number;
  vy: number;
  ly: number;
}[] = [
  { k: "pac", l: "PAC", vx: 21.3, lx: 32.41, vy: 64.63, ly: 65.24 },
  { k: "dri", l: "DRI", vx: 56.48, lx: 67.59, vy: 64.63, ly: 65.24 },
  { k: "sho", l: "SHO", vx: 21.3, lx: 32.41, vy: 72.2, ly: 72.8 },
  { k: "def", l: "DEF", vx: 56.48, lx: 67.59, vy: 72.2, ly: 72.8 },
  { k: "pas", l: "PAS", vx: 21.3, lx: 32.41, vy: 79.76, ly: 80.37 },
  { k: "phy", l: "PHY", vx: 56.48, lx: 67.59, vy: 79.76, ly: 80.37 },
];

const H_LINES: [number, number, number][] = [
  [19.44, 31.1, 10.19],
  [19.44, 40.85, 10.19],
  [16.67, 64.02, 66.67],
  [44.44, 89.63, 11.11],
];

const hideOnError: React.ReactEventHandler<HTMLImageElement> = (e) => {
  e.currentTarget.style.visibility = "hidden";
};

function PlayerCard({ card }: { card: Card }) {
  const t = resolveCardTheme(card);
  const ink = t.ink;
  const displayName = cardDisplayName(card.name).toUpperCase();
  const avatarSrc = cardAvatarSrc(card.avatarUrl) || AVATAR_FALLBACK;

  const onAvatarError: React.ReactEventHandler<HTMLImageElement> = (e) => {
    const el = e.currentTarget;
    // First failure: try raw remote URL without proxy (some CDNs block our server fetch)
    const raw = (card.avatarUrl || "").trim();
    if (
      raw &&
      /^https?:\/\//i.test(raw) &&
      el.src.includes("/api/img") &&
      !el.dataset.triedRaw
    ) {
      el.dataset.triedRaw = "1";
      el.removeAttribute("crossorigin");
      el.src = raw;
      return;
    }
    el.onerror = null;
    el.src = AVATAR_FALLBACK;
  };

  const wrap: CSSProperties = {
    containerType: "inline-size",
    position: "relative",
    width: "100%",
    aspectRatio: "540 / 820",
    filter: `drop-shadow(0 7cqw 10cqw rgba(0,0,0,.5)) drop-shadow(0 0 6cqw ${t.glow})`,
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTouchCallout: "none",
  };

  const at = (left: number, top: number): CSSProperties => ({
    position: "absolute",
    left: `${left}%`,
    top: `${top}%`,
  });

  return (
    <div className="bento-card-frame" style={wrap}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={t.bg}
        alt=""
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "fill",
        }}
      />
      <div
        data-bento-avatar
        style={{
          position: "absolute",
          inset: 0,
          WebkitMaskImage: `url("${t.bg}")`,
          maskImage: `url("${t.bg}")`,
          WebkitMaskSize: "100% 100%",
          maskSize: "100% 100%",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: "27cqw",
            top: "13cqw",
            width: "68cqw",
            height: "70cqw",
            WebkitMaskImage: AVATAR_MASK_FEATHER,
            maskImage: AVATAR_MASK_FEATHER,
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              WebkitMaskImage: AVATAR_MASK_BOTTOM_FADE,
              maskImage: AVATAR_MASK_BOTTOM_FADE,
            }}
          >
            <div
              style={{
                position: "relative",
                width: "100%",
                height: "100%",
                WebkitMaskImage: AVATAR_MASK_TOP_FADE,
                maskImage: AVATAR_MASK_TOP_FADE,
                filter: `drop-shadow(0 3cqw 6cqw rgba(0,0,0,.5)) drop-shadow(0 0 5cqw ${t.avatarHalo})`,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={avatarSrc}
                onError={onAvatarError}
                alt={card.login}
                crossOrigin="anonymous"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: "center 20%",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: t.avatarTint,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {H_LINES.map(([l, top, w], i) => (
        <div
          key={i}
          style={{
            ...at(l, top),
            width: `${w}%`,
            height: "0.3cqw",
            background: ink,
            opacity: 0.5,
          }}
        />
      ))}
      <div
        style={{
          ...at(50, 66.46),
          width: "0.3cqw",
          height: "20.12%",
          background: ink,
          opacity: 0.5,
        }}
      />

      <div
        style={{
          ...at(16.3, 9.76),
          fontFamily: FONT_MEDIUM,
          fontSize: "22.2cqw",
          fontWeight: 500,
          lineHeight: 1,
          color: ink,
        }}
      >
        {pad2(card.overall)}
      </div>

      <div
        style={{
          ...at(25, 23.78),
          transform: "translateX(-50%)",
          fontFamily: FONT_COND,
          fontSize: "9.3cqw",
          fontWeight: 500,
          letterSpacing: ".02em",
          color: ink,
        }}
      >
        {card.position}
      </div>

      {card.country && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/badges/flags/${card.country}.png`}
          onError={hideOnError}
          alt={card.country}
          style={{
            ...at(17.59, 33.17),
            width: "14.81%",
            height: "5.73%",
            objectFit: "contain",
          }}
        />
      )}

      {card.languageLogo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={languageLogoUrl(card.languageLogo.slug)}
          crossOrigin="anonymous"
          onError={hideOnError}
          alt={card.languageLogo.name}
          title={card.languageLogo.name}
          style={{
            ...at(19.06, 42.25),
            width: "11.875%",
            height: "7.5%",
            objectFit: "contain",
          }}
        />
      )}

      <div
        style={{
          ...at(50, 53.66),
          transform: "translateX(-50%)",
          fontFamily: FONT_BOLD,
          fontSize: "13cqw",
          fontWeight: 700,
          whiteSpace: "nowrap",
          color: ink,
        }}
      >
        {displayName}
      </div>

      {STAT_CELLS.map((c) => (
        <div key={c.k}>
          <span
            style={{
              ...at(c.vx, c.vy),
              fontFamily: FONT_BOLD,
              fontSize: "10.2cqw",
              fontWeight: 700,
              color: ink,
            }}
          >
            {pad2(card.stats[c.k])}
          </span>
          <span
            style={{
              ...at(c.lx, c.ly),
              fontFamily: FONT_COND,
              fontSize: "9.3cqw",
              fontWeight: 500,
              letterSpacing: ".02em",
              color: ink,
            }}
          >
            {c.l}
          </span>
        </div>
      ))}

      <div className="bento-signature">
        <div
          style={{
            ...at(8, 94.8),
            fontFamily: FONT_BOLD,
            fontSize: "4.1cqw",
            fontWeight: 700,
            letterSpacing: ".1em",
            lineHeight: 1,
            whiteSpace: "nowrap",
            color: ink,
            opacity: 0.62,
          }}
        >
          BENTO.FUN
        </div>
        <div
          style={{
            position: "absolute",
            right: "8%",
            top: "94.8%",
            maxWidth: "40%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontFamily: FONT_BOLD,
            fontSize: "4.1cqw",
            fontWeight: 700,
            letterSpacing: ".1em",
            lineHeight: 1,
            whiteSpace: "nowrap",
            color: ink,
            opacity: 0.62,
          }}
        >
          @{card.login}
        </div>
      </div>
    </div>
  );
}

export default memo(PlayerCard);
