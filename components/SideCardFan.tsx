"use client";

import { useState } from "react";
import type { Card } from "@/lib/scoring/types";
import PlayerCard from "./PlayerCard";
import GeminiCard, { hasGeminiCardArt } from "./GeminiCard";

interface Props {
  cards: Card[];
  onPick: (login: string) => void;
}

/**
 * Overlapping FUT deck — slight rotation + cascade like a pack fan.
 */
export default function SideCardFan({ cards, onPick }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const deck = cards.slice(0, 5);
  if (deck.length === 0) return null;

  return (
    <div
      className="relative mx-auto h-[min(540px,75vh)] w-full max-w-[460px] max-[980px]:h-[420px] max-[980px]:max-w-[360px]"
      aria-label="Market cards"
    >
      {deck.map((card, i) => {
        const n = deck.length;
        const mid = (n - 1) / 2;
        // Index 0 is the featured front card (rightmost, on top).
        const offset = mid - i;
        const hovered = hover === i;
        const rot = offset * 6.5;
        const x = offset * 48;
        const y = Math.abs(offset) * 8 + (hovered ? -22 : 0);
        const scale = hovered ? 1.1 : 1 - Math.abs(offset) * 0.028;

        return (
          <button
            key={card.login}
            type="button"
            onClick={() => onPick(card.login)}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            aria-label={`Open ${card.name}`}
            className="absolute left-1/2 top-1/2 w-[min(210px,52vw)] origin-center transition-[transform,filter] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] max-[980px]:w-[168px]"
            style={{
              transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${rot}deg) scale(${scale})`,
              zIndex: hovered ? 40 : 10 + (n - 1 - i),
              filter: hovered
                ? "drop-shadow(0 20px 32px rgba(0,0,0,.6))"
                : "drop-shadow(0 12px 20px rgba(0,0,0,.45))",
            }}
          >
            {hasGeminiCardArt(card) ? (
              <GeminiCard card={card} />
            ) : (
              <PlayerCard card={card} />
            )}
          </button>
        );
      })}
    </div>
  );
}
