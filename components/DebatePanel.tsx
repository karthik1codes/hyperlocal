"use client";

import type { DebateResult } from "@/lib/club/debate/types";

const SOURCE_TONE: Record<string, string> = {
  bento: "text-brand",
  card: "text-gold-hi",
  club: "text-ink-soft",
  catalog: "text-ink-faint",
  external: "text-ink-mute",
};

export default function DebatePanel({
  debate,
  onClose,
}: {
  debate: DebateResult;
  onClose?: () => void;
}) {
  const { verdict, arguments: desks, evidence, optionA, optionB, mode } = debate;
  const desksOnly = desks.filter((d) => d.agentId !== "judge");

  return (
    <div className="rounded-2xl border border-brand/30 bg-bg-deep/90 p-4 shadow-[0_20px_60px_rgba(0,0,0,.45)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-display text-[12px] tracking-[.22em] text-brand">
            AGENT DEBATE
          </div>
          <h3 className="font-display mt-1 text-[22px] leading-tight text-ink">
            {debate.question || debate.card?.name}
          </h3>
          <p className="mt-1 text-[12px] text-ink-faint">
            {optionA} vs {optionB} · {mode === "structured+llm" ? "structured + LLM judge" : "structured desks"} ·{" "}
            {new Date(debate.ranAt).toLocaleTimeString()}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-2.5 py-1 text-[12px] text-ink-soft hover:border-brand/40"
          >
            Close
          </button>
        )}
      </div>

      <div className="mt-4 rounded-xl border border-brand/25 bg-brand/[0.08] px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-display text-[11px] tracking-[.18em] text-brand">VERDICT</span>
          <span className="font-display text-[28px] leading-none text-ink">
            {verdict.pickLabel}
          </span>
          <span className="font-mono text-[14px] text-brand-hi">{verdict.confidence}%</span>
        </div>
        <p className="mt-2 text-[13.5px] leading-snug text-ink-soft">
          {verdict.summary.replace(/\*\*/g, "")}
        </p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {desksOnly.map((d) => (
          <article
            key={d.agentId}
            className="rounded-xl border border-line bg-white/[0.03] p-3"
          >
            <div className="font-display text-[12px] tracking-[.14em] text-gold-hi">
              {d.name}
            </div>
            <div className="mt-0.5 text-[11px] text-ink-faint">{d.role}</div>
            <div className="mt-2 font-mono text-[12px] text-brand">
              {d.side === "A" ? optionA : d.side === "B" ? optionB : "PASS"} · {d.confidence}%
            </div>
            <p className="mt-2 text-[12px] leading-snug text-ink-soft">{d.thesis}</p>
            <ul className="mt-2 space-y-1.5">
              {d.points.slice(0, 3).map((p, i) => (
                <li key={i} className="text-[11px] leading-snug text-ink-faint">
                  · {p.length > 140 ? `${p.slice(0, 140)}…` : p}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <div className="mt-4 border-t border-white/[0.08] pt-4">
        <h4 className="font-display text-[11px] tracking-[.18em] text-brand">
          WHY THIS ANALYSIS IS MORE ACCURATE
        </h4>
        <ul className="mt-2 space-y-2">
          {verdict.whyAccurate.map((w, i) => (
            <li key={i} className="text-[13px] leading-snug text-ink-soft">
              {w}
            </li>
          ))}
        </ul>
      </div>

      {verdict.disagreements.length > 0 && (
        <div className="mt-4">
          <h4 className="font-display text-[11px] tracking-[.18em] text-ink-faint">
            DISAGREEMENTS
          </h4>
          <ul className="mt-2 space-y-1.5">
            {verdict.disagreements.map((d, i) => (
              <li key={i} className="text-[12px] text-ink-soft">
                {d}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <h4 className="font-display text-[11px] tracking-[.18em] text-ink-faint">
          SOURCES ({evidence.length})
        </h4>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {verdict.sourcesUsed.map((s, i) => (
            <li key={`${s.label}-${i}`} className="text-[11.5px] text-ink-soft">
              <span className={SOURCE_TONE[s.source] || "text-ink-mute"}>
                [{s.source}]
              </span>{" "}
              {s.url ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline-offset-2 hover:text-brand hover:underline"
                >
                  {s.label}
                </a>
              ) : (
                s.label
              )}
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-4 text-[11px] leading-snug text-ink-mute">
        {verdict.caveats.join(" ")}
      </p>
    </div>
  );
}
