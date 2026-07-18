import { describe, expect, it } from "vitest";
import { isMarketTradeable } from "@/lib/bento/tradeable";

describe("isMarketTradeable", () => {
  it("rejects status=-1 (production demo failure mode)", () => {
    const r = isMarketTradeable({ status: -1, endsIn: 2, duelType: "prediction" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/paused|invalid/i);
  });

  it("rejects near-expiry seconds", () => {
    const r = isMarketTradeable({ status: 1, endsIn: 2, duelType: "prediction" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/expire/i);
  });

  it("accepts healthy open markets", () => {
    const r = isMarketTradeable({
      status: 1,
      endsIn: 86_400,
      duelType: "prediction",
    });
    expect(r).toEqual({ ok: true });
  });
});
