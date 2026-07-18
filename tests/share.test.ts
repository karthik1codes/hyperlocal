import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/scoring/types";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
  vi.resetModules();
});

const card = (over: Partial<Card> = {}): Card =>
  ({
    login: "demo-btc-100k",
    name: "BTC Hits 100k",
    avatarUrl: "https://example.com/a.png",
    country: "us",
    club: "legends",
    stats: { pac: 74, sho: 97, pas: 90, dri: 69, def: 65, phy: 96 },
    position: "ST",
    family: "Forward",
    baseOVR: 88,
    overall: 95,
    finish: "icon",
    finishLabel: "ICON",
    archetype: "Galáctico",
    archetypeBlurb: "hall-of-fame market",
    legacy: { L: 1 },
    report: {
      skillMoves: 3,
      weakFoot: 4,
      workRate: { attack: "High", defense: "Med" },
      style: "Relentless",
      reasons: { skillMoves: "", weakFoot: "", workRate: "", style: "" },
      playstyles: [],
      metrics: [],
    },
    ...over,
  }) as Card;

describe("share service", () => {
  it("builds the canonical card URL from the login, encoding the displayed flag", async () => {
    const { cardUrl } = await import("@/lib/share");
    expect(cardUrl(card())).toBe("http://localhost:3000/demo-btc-100k?country=us");
  });

  it("omits the country param when the card has no flag", async () => {
    const { cardUrl } = await import("@/lib/share");
    expect(cardUrl(card({ country: "" }))).toBe("http://localhost:3000/demo-btc-100k");
  });

  it("X intent uses /intent/tweet (NOT /intent/post) and carries url + hashtag", async () => {
    const { intentUrl } = await import("@/lib/share");
    const u = intentUrl("x", card());
    expect(u).toContain("https://twitter.com/intent/tweet?");
    expect(u).not.toContain("/intent/post");
    expect(u).toContain("hashtags=BentoCards");
    expect(u).toContain(encodeURIComponent("http://localhost:3000/demo-btc-100k?country=us"));
  });

  it("LinkedIn intent uses share-offsite with only the url (preview from OG)", async () => {
    const { intentUrl } = await import("@/lib/share");
    const u = intentUrl("linkedin", card());
    expect(u).toContain("linkedin.com/sharing/share-offsite/?url=");
    expect(u).toContain(encodeURIComponent("http://localhost:3000/demo-btc-100k?country=us"));
  });

  it("WhatsApp intent puts text + url in the message", async () => {
    const { intentUrl } = await import("@/lib/share");
    const u = intentUrl("whatsapp", card());
    expect(u).toContain("api.whatsapp.com/send?text=");
    expect(decodeURIComponent(u)).toContain("localhost:3000/demo-btc-100k?country=us");
  });

  it("share text is deterministic per login and mentions the rating", async () => {
    const { shareText } = await import("@/lib/share");
    const a = shareText(card());
    const b = shareText(card());
    expect(a).toBe(b);
    expect(a).toContain("95");
  });

  it("different logins can select different lines", async () => {
    const { shareText } = await import("@/lib/share");
    const a = shareText(card({ login: "demo-btc-100k" }));
    const b = shareText(card({ login: "demo-fed-cut" }));
    const c = shareText(card({ login: "demo-lakers-celtics" }));
    expect(new Set([a, b, c]).size).toBeGreaterThan(1);
  });

  it("native payload carries title, brag-led text, and url", async () => {
    const { nativeSharePayload, shareMessage } = await import("@/lib/share");
    const p = nativeSharePayload(card());
    expect(p.title).toBe("Bento Cards");
    expect(p.url).toBe("http://localhost:3000/demo-btc-100k?country=us");
    expect(p.text).toBe(shareMessage(card()));
    expect(p.text).toContain("open the books");
  });

  it("share message is the text plus the CTA", async () => {
    const { shareMessage, shareText } = await import("@/lib/share");
    expect(shareMessage(card())).toContain(shareText(card()));
  });
});

describe("duel share service", () => {
  it("builds the canonical duel URL from both corners", async () => {
    const { duelUrl } = await import("@/lib/share");
    expect(duelUrl("demo-btc-100k", "demo-fed-cut")).toBe(
      "http://localhost:3000/demo-btc-100k/vs/demo-fed-cut",
    );
  });

  it("message is deterministic per matchup, @-mentions the opponent, and never spoils the score", async () => {
    const { duelShareMessage } = await import("@/lib/share");
    const a = duelShareMessage("demo-btc-100k", "demo-fed-cut");
    expect(a).toBe(duelShareMessage("demo-btc-100k", "demo-fed-cut"));
    expect(a).toContain("@demo-fed-cut");
    expect(a).not.toMatch(/\d+\s*[–-]\s*\d+/);
  });

  it("swapping corners can change the line (matchup-seeded, not opponent-only)", async () => {
    const { duelShareMessage } = await import("@/lib/share");
    const lines = new Set([
      duelShareMessage("a", "b"),
      duelShareMessage("b", "a"),
      duelShareMessage("c", "d"),
      duelShareMessage("e", "f"),
    ]);
    expect(lines.size).toBeGreaterThan(1);
  });

  it("X intent uses /intent/tweet (NOT /intent/post) with the duel url + hashtag", async () => {
    const { duelIntentUrl } = await import("@/lib/share");
    const u = duelIntentUrl("demo-btc-100k", "demo-fed-cut");
    expect(u).toContain("https://twitter.com/intent/tweet?");
    expect(u).not.toContain("/intent/post");
    expect(u).toContain("hashtags=BentoCards");
    expect(u).toContain(encodeURIComponent("http://localhost:3000/demo-btc-100k/vs/demo-fed-cut"));
  });

  it("native payload carries the title, the message, and the duel url", async () => {
    const { duelSharePayload, duelShareMessage } = await import("@/lib/share");
    const p = duelSharePayload("demo-btc-100k", "demo-fed-cut");
    expect(p.title).toBe("Bento Duel");
    expect(p.url).toBe("http://localhost:3000/demo-btc-100k/vs/demo-fed-cut");
    expect(p.text).toBe(duelShareMessage("demo-btc-100k", "demo-fed-cut"));
  });
});
