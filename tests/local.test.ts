import { describe, expect, it } from "vitest";
import { predictionFromNews, makeLocalLogin } from "@/lib/local/card";

describe("hyper-local prediction", () => {
  it("keeps an explicit Will… question", () => {
    const q = predictionFromNews({
      region: "Chennai",
      topic: "Will the Chennai Metro Phase 2 line open for the public before December?",
      hit: {
        title: "Metro update",
        url: "https://example.com/a",
        summary: "Phase 2 progress",
        imageUrl: null,
        sourceHost: "example.com",
      },
    });
    expect(q.toLowerCase().startsWith("will")).toBe(true);
    expect(q.endsWith("?")).toBe(true);
  });

  it("templates a Yes/No from freeform topics", () => {
    const q = predictionFromNews({
      region: "District X",
      topic: "zoning law for high-rise residential",
      hit: {
        title: "Zoning debate",
        url: "https://example.com/b",
        summary: "Council hears proposals",
        imageUrl: null,
        sourceHost: "example.com",
      },
    });
    expect(q).toMatch(/Will/i);
    expect(q).toMatch(/District X/);
  });

  it("mints local- login ids", () => {
    expect(makeLocalLogin("Chennai", "Metro Phase 2").startsWith("local-chennai-")).toBe(true);
  });
});
