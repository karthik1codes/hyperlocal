import { describe, expect, it } from "vitest";
import { gatherEvidence, optionLabels } from "@/lib/club/debate/evidence";
import { runStructuredDebate } from "@/lib/club/debate/agents";
import { EMPTY_CLUB } from "@/lib/club/types";
import { SAMPLE_CARDS } from "@/lib/bento/samples";
import { addToSquad } from "@/lib/club/squad";

describe("club debate", () => {
  it("gathers evidence from card + market + club", () => {
    const card = SAMPLE_CARDS[0];
    const club = addToSquad({ ...EMPTY_CLUB, slots: {}, feed: [] }, card);
    const evidence = gatherEvidence(card, club, SAMPLE_CARDS);
    expect(evidence.length).toBeGreaterThan(4);
    expect(evidence.some((e) => e.source === "card")).toBe(true);
    expect(evidence.some((e) => e.id === "card-ovr")).toBe(true);
  });

  it("runs bull/bear/risk/judge and returns a verdict with whyAccurate", () => {
    const card = SAMPLE_CARDS.find((c) => c.market?.duelType === "versus") || SAMPLE_CARDS[0];
    const { optionA, optionB } = optionLabels(card);
    const evidence = gatherEvidence(card, null, SAMPLE_CARDS);
    const debate = runStructuredDebate(card, evidence);

    expect(debate.optionA).toBe(optionA);
    expect(debate.optionB).toBe(optionB);
    expect(debate.arguments.map((a) => a.agentId).sort()).toEqual(
      ["bear", "bull", "judge", "risk"].sort(),
    );
    expect(["A", "B", "PASS"]).toContain(debate.verdict.pick);
    expect(debate.verdict.whyAccurate.length).toBeGreaterThan(2);
    expect(debate.verdict.sourcesUsed.length).toBe(evidence.length);
    expect(debate.verdict.confidence).toBeGreaterThanOrEqual(40);
  });
});
