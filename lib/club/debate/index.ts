export type {
  AgentArgument,
  DebateAgentId,
  DebateResult,
  DebateSide,
  DebateVerdict,
  EvidenceItem,
} from "./types";
export { DEBATE_AGENTS } from "./types";
export { gatherEvidence, optionLabels } from "./evidence";
export { runBull, runBear, runRisk, runJudge, runStructuredDebate } from "./agents";
export { runClubDebate } from "./run";
