import type { Card } from "@/lib/scoring/types";

export type DebateSide = "A" | "B" | "PASS";

export type DebateAgentId = "bull" | "bear" | "risk" | "judge";

export interface EvidenceItem {
  id: string;
  source: "bento" | "card" | "club" | "catalog" | "external";
  label: string;
  detail: string;
  weight: number; // -2..+2 toward side A (negative = B)
  url?: string | null;
}

export interface AgentArgument {
  agentId: DebateAgentId;
  name: string;
  role: string;
  side: DebateSide;
  confidence: number; // 0–100
  thesis: string;
  points: string[];
  evidenceIds: string[];
  risks: string[];
}

export interface DebateVerdict {
  pick: DebateSide;
  pickLabel: string;
  confidence: number;
  summary: string;
  whyAccurate: string[];
  disagreements: string[];
  caveats: string[];
  sourcesUsed: { label: string; source: EvidenceItem["source"]; url?: string | null }[];
}

export interface DebateResult {
  marketId: string;
  question: string;
  optionA: string;
  optionB: string;
  card?: Card;
  evidence: EvidenceItem[];
  arguments: AgentArgument[];
  verdict: DebateVerdict;
  mode: "structured" | "structured+llm";
  ranAt: number;
}

export const DEBATE_AGENTS: {
  id: DebateAgentId;
  name: string;
  role: string;
}[] = [
  { id: "bull", name: "Bull Desk", role: "Case for option A" },
  { id: "bear", name: "Bear Desk", role: "Case for option B" },
  { id: "risk", name: "Risk Desk", role: "Liquidity, timing, settlement" },
  { id: "judge", name: "Judge", role: "Weighs evidence and explains the call" },
];
