import { describe, expect, it } from "vitest";
import { buildCard } from "@/lib/scoring/engine";
import type { Signals } from "@/lib/scoring/types";

const base: Signals = {
  login: "demo-market",
  name: "Demo Market",
  avatarUrl: "https://example.com/a.png",
  location: "Markets",
  followers: 50,
  account_age_years: 3,
  public_repos: 20,
  total_stars_owned: 100,
  max_repo_stars: 40,
  languages: 5,
  rankedLanguages: ["Football", "Crypto"],
  topLanguage: "Football",
  recent_contributions: 300,
  active_days_recent: 100,
  active_years: 3,
  total_contributions_lifetime: 1500,
  prs_to_others: 5,
  reviews: 3,
  issues_closed: 4,
  recent_commits: 280,
  recent_spike: false,
};

describe("buildCard", () => {
  it("produces a card with six stats and a finish", () => {
    const card = buildCard(base);
    expect(card.login).toBe("demo-market");
    expect(card.stats.pac).toBeGreaterThan(0);
    expect(card.overall).toBeGreaterThan(0);
    expect(card.overall).toBeLessThanOrEqual(99);
    expect(["bronze", "silver", "gold", "totw", "toty", "icon"]).toContain(card.finish);
  });

  it("scores arbitrary logins through the normal finish ladder", () => {
    const card = buildCard({ ...base, login: "demo-market" });
    expect(["bronze", "silver", "gold", "totw", "toty", "icon"]).toContain(card.finish);
  });
});
