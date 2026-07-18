"use client";

import { useState } from "react";
import type { Card } from "@/lib/scoring/types";
import PlayerCard from "./PlayerCard";
import GeminiCard, { hasGeminiCardArt } from "./GeminiCard";

interface Props {
  cards: Card[];
  onPick: (login: string) => void;
  /** Optional section label above the fan. */
  label?: string;
}

/** Full cards in a scrollable row — scrollbar hidden, swipe/wheel still works. */
export default function CardFan({ cards, onPick, label }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  if (cards.length === 0) return null;

  return (
    <div className="relative z-0 flex min-w-0 w-full flex-col justify-center">
      {label && (
        <div className="font-display mb-3 text-[11px] tracking-[.2em] text-brand">{label}</div>
      )}
      <div
        className="relative flex gap-3 overflow-x-auto overflow-y-visible px-1 py-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-4"
        style={{ scrollSnapType: "x mandatory" }}
      >
        {cards.map((card, i) => {
          const hovered = hover === i;
          return (
            <button
              key={card.login}
              type="button"
              onClick={() => onPick(card.login)}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              aria-label={`Scout ${card.name}`}
              className="relative w-[168px] shrink-0 snap-center transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)] sm:w-[190px]"
              style={{
                transform: hovered ? "translateY(-12px) scale(1.04)" : "none",
                zIndex: hovered ? 2 : 1,
              }}
            >
              {hasGeminiCardArt(card) ? (
                <GeminiCard card={card} />
              ) : (
                <PlayerCard card={card} />
              )}
              <span className="mt-2 block truncate text-center text-[11px] font-semibold text-ink-soft">
                {card.overall} · {card.position} · {card.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
