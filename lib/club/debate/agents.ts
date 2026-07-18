import type { Card } from "@/lib/scoring/types";
import {
  DEBATE_AGENTS,
  type AgentArgument,
  type DebateResult,
  type DebateSide,
  type DebateVerdict,
  type EvidenceItem,
} from "./types";
import { optionLabels } from "./evidence";

function sumWeight(evidence: EvidenceItem[], ids: string[]) {
  const set = new Set(ids);
  return evidence.filter((e) => set.has(e.id)).reduce((s, e) => s + e.weight, 0);
}

function pickEvidence(evidence: EvidenceItem[], prefer: "positive" | "negative" | "risk") {
  const sorted = [...evidence].sort((a, b) => {
    if (prefer === "positive") return b.weight - a.weight;
    if (prefer === "negative") return a.weight - b.weight;
    return Math.abs(b.weight) - Math.abs(a.weight);
  });
  return sorted.slice(0, 4);
}

export function runBull(evidence: EvidenceItem[], optionA: string): AgentArgument {
  const picks = pickEvidence(evidence, "positive");
  const score = sumWeight(evidence, picks.map((e) => e.id));
  const confidence = Math.round(clamp(55 + score * 18, 35, 88));
  return {
    agentId: "bull",
    name: DEBATE_AGENTS[0].name,
    role: DEBATE_AGENTS[0].role,
    side: "A",
    confidence,
    thesis: `Lean ${optionA}: the tape and card shape support option A more than the alternative.`,
    points: picks.map((e) => `${e.label}: ${e.detail}`),
    evidenceIds: picks.map((e) => e.id),
    risks: [
      "Bull case can overfit hot PAC without checking settlement clarity.",
      "Volume can be one-sided noise, not true conviction.",
    ],
  };
}

export function runBear(evidence: EvidenceItem[], optionB: string): AgentArgument {
  const picks = pickEvidence(evidence, "negative");
  const score = -sumWeight(evidence, picks.map((e) => e.id));
  const confidence = Math.round(clamp(55 + score * 18, 35, 88));
  return {
    agentId: "bear",
    name: DEBATE_AGENTS[1].name,
    role: DEBATE_AGENTS[1].role,
    side: "B",
    confidence,
    thesis: `Lean ${optionB}: fade the crowded or thin narrative — option B has the cleaner risk/reward.`,
    points: picks.map((e) => `${e.label}: ${e.detail}`),
    evidenceIds: picks.map((e) => e.id),
    risks: [
      "Bear case may undervalue genuine momentum when PAC and SHO both print high.",
      "Contrarian fades lose when the market is correctly informed early.",
    ],
  };
}

export function runRisk(evidence: EvidenceItem[]): AgentArgument {
  const timing = evidence.find((e) => e.id === "bento-timing");
  const vol = evidence.find((e) => e.id === "bento-volume");
  const corr = evidence.find((e) => e.id === "club-corr");
  const status = evidence.find((e) => e.id === "bento-status");
  const risks: string[] = [];
  let passPressure = 0;

  if (timing && timing.weight < -0.5) {
    risks.push(timing.detail);
    passPressure += 1.2;
  }
  if (vol && vol.weight < -0.3) {
    risks.push(vol.detail);
    passPressure += 0.8;
  }
  if (corr) {
    risks.push(corr.detail);
    passPressure += 0.6;
  }
  if (status && status.weight < -0.5) {
    risks.push(status.detail);
    passPressure += 1.5;
  }
  if (!risks.length) {
    risks.push("No red-flag liquidity or timing issues standing out — still size small on credits.");
  }

  const side: DebateSide = passPressure >= 2.2 ? "PASS" : passPressure >= 1.2 ? "PASS" : "A";
  const confidence = Math.round(clamp(40 + passPressure * 20, 40, 92));

  return {
    agentId: "risk",
    name: DEBATE_AGENTS[2].name,
    role: DEBATE_AGENTS[2].role,
    side: passPressure >= 1.2 ? "PASS" : side,
    confidence,
    thesis:
      passPressure >= 1.2
        ? "Risk desk prefers PASS or tiny size — timing/liquidity/settlement stack against a clean call."
        : "Risk is manageable for Free-to-Play credits if size stays modest.",
    points: risks,
    evidenceIds: [timing, vol, corr, status].filter(Boolean).map((e) => e!.id),
    risks: ["Risk desk can be overly conservative and miss priced opportunities."],
  };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function runJudge(
  card: Card,
  evidence: EvidenceItem[],
  args: AgentArgument[],
): DebateVerdict {
  const { optionA, optionB } = optionLabels(card);
  const bull = args.find((a) => a.agentId === "bull")!;
  const bear = args.find((a) => a.agentId === "bear")!;
  const risk = args.find((a) => a.agentId === "risk")!;

  const net =
    evidence.reduce((s, e) => s + e.weight, 0) +
    (bull.confidence - bear.confidence) / 40;

  let pick: DebateSide = "PASS";
  if (risk.side === "PASS" && risk.confidence >= 70) {
    pick = "PASS";
  } else if (net > 0.55) {
    pick = "A";
  } else if (net < -0.55) {
    pick = "B";
  } else if (Math.abs(bull.confidence - bear.confidence) >= 12) {
    pick = bull.confidence > bear.confidence ? "A" : "B";
  } else {
    pick = "PASS";
  }

  const pickLabel = pick === "A" ? optionA : pick === "B" ? optionB : "PASS / no edge";
  const confidence = Math.round(
    clamp(
      pick === "PASS"
        ? Math.max(risk.confidence, 48)
        : 50 + Math.abs(net) * 22 + Math.abs(bull.confidence - bear.confidence) / 4,
      42,
      90,
    ),
  );

  const topForPick =
    pick === "A"
      ? pickEvidence(evidence, "positive")
      : pick === "B"
        ? pickEvidence(evidence, "negative")
        : pickEvidence(evidence, "risk");

  const whyAccurate = [
    `Judge weighed ${evidence.length} evidence items from Bento tape, card stats, club book, and catalog peers — not a single odds number.`,
    `Bull confidence ${bull.confidence} vs Bear ${bear.confidence}; Risk ${risk.side} @ ${risk.confidence}.`,
    ...topForPick.slice(0, 3).map((e) => `Key: ${e.label} — ${e.detail}`),
    pick === "PASS"
      ? "No clear edge after debate — accuracy here means knowing when not to force a side."
      : `Pick ${pickLabel} because net evidence score ${net.toFixed(2)} cleared the debate threshold with coherent desk support.`,
  ];

  const disagreements: string[] = [];
  if (Math.abs(bull.confidence - bear.confidence) < 8) {
    disagreements.push("Bull and Bear are close — market is contested; size down.");
  } else {
    disagreements.push(
      `Bull wants ${optionA} (${bull.confidence}); Bear wants ${optionB} (${bear.confidence}).`,
    );
  }
  if (risk.side === "PASS" && pick !== "PASS") {
    disagreements.push("Risk desk urged PASS while Judge still sees a directional lean — treat as soft conviction.");
  }

  const caveats = [
    "Agents improve explanation quality; they do not guarantee outcomes.",
    "Testnet credits markets can have odd status/endsIn — verify before staking.",
    ...(card.market?.source === "polymarket"
      ? ["Polymarket cards are scout-only here; settle on native Bento duels."]
      : []),
  ];

  const sourcesUsed = evidence.map((e) => ({
    label: e.label,
    source: e.source,
    url: e.url,
  }));

  const summary =
    pick === "PASS"
      ? `No trade: desks disagree or risk flags dominate on “${card.name}”.`
      : `Lean **${pickLabel}** on “${card.name}” at ${confidence}% confidence after Bull/Bear/Risk debate.`;

  return {
    pick,
    pickLabel,
    confidence,
    summary,
    whyAccurate,
    disagreements,
    caveats,
    sourcesUsed,
  };
}

export function runStructuredDebate(
  card: Card,
  evidence: EvidenceItem[],
): Omit<DebateResult, "mode" | "ranAt"> {
  const { optionA, optionB } = optionLabels(card);
  const bull = runBull(evidence, optionA);
  const bear = runBear(evidence, optionB);
  const risk = runRisk(evidence);
  const desks = [bull, bear, risk];
  const verdict = runJudge(card, evidence, desks);

  return {
    marketId: card.market?.duelId || card.login,
    question: card.market?.question || card.name,
    optionA,
    optionB,
    card,
    evidence,
    arguments: [
      ...desks,
      {
        agentId: "judge",
        name: DEBATE_AGENTS[3].name,
        role: DEBATE_AGENTS[3].role,
        side: verdict.pick,
        confidence: verdict.confidence,
        thesis: verdict.summary.replace(/\*\*/g, ""),
        points: verdict.whyAccurate,
        evidenceIds: evidence.slice(0, 5).map((e) => e.id),
        risks: verdict.caveats,
      },
    ],
    verdict,
  };
}
