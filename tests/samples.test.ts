import { describe, expect, it } from "vitest";
import { SAMPLE_CARDS } from "@/lib/bento/samples";

describe("showcase samples", () => {
  const by = Object.fromEntries(SAMPLE_CARDS.map((c) => [c.login, c]));

  it("includes baked Bento demo markets with market meta", () => {
    expect(by["demo-btc-100k"]).toBeDefined();
    expect(by["demo-btc-100k"].market?.duelType).toBe("prediction");
    expect(by["demo-lakers-celtics"].market?.options).toEqual(["Lakers", "Celtics"]);
    expect(by["demo-fed-cut"]).toBeDefined();
    expect(by["demo-ai-ipo"]).toBeDefined();
  });

  it("builds a finish label and overall for every sample", () => {
    for (const c of SAMPLE_CARDS) {
      expect(c.overall).toBeGreaterThan(0);
      expect(c.finishLabel.length).toBeGreaterThan(0);
      expect(c.market?.duelId).toBe(c.login);
    }
  });

  it("has no leftover GitFut demo ids", () => {
    expect(by["demo-finals"]).toBeUndefined();
    expect(by["demo-el-clasico"]).toBeUndefined();
  });
});
