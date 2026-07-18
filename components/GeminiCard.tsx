"use client";

import { memo, type CSSProperties } from "react";
import type { Card } from "@/lib/scoring/types";

/**
 * Full-bleed card: Gemini (or other) generated FUT plate — no CSS overlay template.
 */
function GeminiCard({ card }: { card: Card }) {
  const src = card.cardImageUrl;
  if (!src) return null;

  const wrap: CSSProperties = {
    containerType: "inline-size",
    position: "relative",
    width: "100%",
    aspectRatio: "540 / 820",
    filter: "drop-shadow(0 7cqw 10cqw rgba(0,0,0,.5))",
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTouchCallout: "none",
  };

  return (
    <div style={wrap}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={`${card.name} · OVR ${card.overall}`}
        draggable={false}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
          borderRadius: "2%",
        }}
      />
    </div>
  );
}

export default memo(GeminiCard);

export function hasGeminiCardArt(card: Card): boolean {
  const art = card.cardImageUrl;
  if (!art || art.length < 32) return false;
  // Prefer CSS plate + pasted crawl photo over AI plates that leave silhouettes
  const avatar = (card.avatarUrl || "").trim();
  if (
    avatar.startsWith("data:image/") ||
    /^https?:\/\//i.test(avatar) ||
    avatar.startsWith("/api/img")
  ) {
    return false;
  }
  return true;
}
