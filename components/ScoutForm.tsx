"use client";

import Link from "next/link";
import Mascot from "./Mascot";

interface Props {
  scoutCount: number | null;
  onOpenModal: () => void;
  /** Tighter hero for markets so the card strip fits the first viewport. */
  compact?: boolean;
}

export default function ScoutForm({ scoutCount, onOpenModal, compact = false }: Props) {
  return (
    <div className="relative z-10 min-w-0 flex-1">
      <div className="mb-1 -ml-2 max-[860px]:mx-auto max-[860px]:flex max-[860px]:justify-center">
        <Mascot size={compact ? 96 : 150} />
      </div>

      <div className="mb-[14px] inline-flex items-center gap-[9px] rounded-[8px] border border-white/[0.08] bg-white/[0.025] px-[12px] py-[6px] max-[860px]:mx-auto">
        <span className="font-display text-[15px] leading-none tracking-[.06em] text-ink">
          BENTO<span className="text-gold-hi">.FUN</span>
        </span>
        <span className="font-display mt-[1px] text-[15px] leading-none text-brand">
          {"\u00d7"}
        </span>
        <span className="font-display text-[15px] leading-none tracking-[.06em] text-ink">
          BETTING <span className="text-gold-hi">CARDS</span>
        </span>
      </div>

      <h1
        className={`font-display m-0 mb-3 leading-[.82] tracking-[.005em] ${
          compact
            ? "text-[clamp(40px,6vw,72px)]"
            : "text-[clamp(52px,7vw,104px)]"
        }`}
      >
        RATE A MARKET<span className="text-brand">.</span>
      </h1>
      <p
        className={`max-w-[420px] font-medium leading-[1.5] text-ink-dim max-[860px]:mx-auto ${
          compact ? "mb-4 text-[14px]" : "mb-[26px] text-[clamp(15px,1.7vw,18px)]"
        }`}
      >
        Turn live Bento markets into player cards — bet with Free-to-Play
        credits on native markets; Props & Futures are scout-only.
      </p>
      <div className="mb-4 flex flex-wrap gap-2 max-[860px]:justify-center">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg border border-brand/30 bg-brand/[0.08] px-3 py-2 text-[13px] font-semibold text-brand-hi transition hover:bg-brand/15"
        >
          Rate hyper-local →
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-x-[14px] gap-y-[10px] max-[860px]:justify-center">
        {scoutCount != null && (
          <>
            <span className="inline-flex items-baseline gap-[9px]">
              <span className="relative flex h-[7px] w-[7px] translate-y-[-1px] self-center" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
                <span className="relative inline-flex h-[7px] w-[7px] rounded-full bg-brand" />
              </span>
              <span className="font-display text-[20px] leading-none tabular-nums text-ink">
                {scoutCount.toLocaleString("en-US")}
              </span>
              <span className="text-[12px] text-ink-mute">cards rated</span>
            </span>
            <span aria-hidden className="h-[12px] w-px bg-white/[0.12] max-[860px]:hidden" />
          </>
        )}
        <button
          type="button"
          onClick={onOpenModal}
          className="cursor-pointer text-[12.5px] font-semibold text-ink-soft underline-offset-2 transition hover:text-brand hover:underline"
        >
          how it works ↗
        </button>
      </div>
    </div>
  );
}
