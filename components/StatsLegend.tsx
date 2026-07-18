"use client";

import { resolveResultTheme } from "./finishTheme";
import type { Card } from "@/lib/scoring/types";

const ROWS: { stat: string; uses: string }[] = [
  {
    stat: "PAC",
    uses: "Recent activity → recent volume / heat",
  },
  {
    stat: "SHO",
    uses: "Total volume + top side pool",
  },
  {
    stat: "PAS",
    uses: "Traders + reach",
  },
  {
    stat: "DRI",
    uses: "Tag / category breadth (58 + 7√tags)",
  },
  {
    stat: "DEF",
    uses: "Depth + balance of the book",
  },
  {
    stat: "PHY",
    uses: "Lifetime volume + market age",
  },
];

/** Footer key on every scout report — how PAC…PHY map to market signals. */
export default function StatsLegend({ card }: { card: Card }) {
  const accent = resolveResultTheme(card).ink;

  return (
    <section className="mx-auto mt-[clamp(28px,5vh,48px)] w-full max-w-[720px] rounded-2xl border border-white/[0.06] bg-white/[0.02] p-[16px] max-[980px]:max-w-[420px]">
      <div className="mb-[10px] flex items-center gap-[9px]">
        <span className="h-[2px] w-[16px] rounded-full" style={{ background: accent }} />
        <h3 className="font-display text-[11px] font-bold tracking-[.22em] text-ink-faint">
          HOW STATS ARE SCORED
        </h3>
      </div>
      <p className="mb-3 text-[12px] leading-snug text-ink-mute">
        Each FUT number is derived from live market signals, then reshaped into a card.
      </p>
      <div className="overflow-hidden rounded-xl border border-white/[0.06]">
        <table className="w-full border-collapse text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-white/[0.06] bg-white/[0.03]">
              <th className="font-display w-[64px] px-3 py-2 text-[10px] font-bold tracking-[.18em] text-ink-faint">
                STAT
              </th>
              <th className="font-display px-3 py-2 text-[10px] font-bold tracking-[.18em] text-ink-faint">
                WHAT IT USES
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.stat} className="border-b border-white/[0.05] last:border-b-0">
                <td
                  className="font-display px-3 py-2.5 text-[13px] font-bold tracking-[.08em]"
                  style={{ color: accent }}
                >
                  {row.stat}
                </td>
                <td className="px-3 py-2.5 leading-snug text-ink-soft">{row.uses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
