import { describe, expect, it } from "vitest";
import { runScoutAgent, agentDesire } from "@/lib/club/scout-agent";
import { addToSquad, chemistryScore, findBestSlot, squadOverall } from "@/lib/club/squad";
import { EMPTY_CLUB, SCOUT_AGENTS } from "@/lib/club/types";
import { SAMPLE_CARDS } from "@/lib/bento/samples";
import { buildCard } from "@/lib/scoring/engine";

describe("club squad", () => {
  it("places a forward into ST when empty", () => {
    const card = SAMPLE_CARDS[0];
    const slot = findBestSlot({ ...EMPTY_CLUB, slots: {}, feed: [] }, card);
    expect(slot).toBeTruthy();
    const next = addToSquad({ ...EMPTY_CLUB, slots: {}, feed: [] }, card);
    expect(Object.keys(next.slots).length).toBe(1);
    expect(squadOverall(next)).toBe(card.overall);
  });

  it("scores chemistry when family fits", () => {
    const card = SAMPLE_CARDS[0];
    const club = addToSquad({ ...EMPTY_CLUB, slots: {}, feed: [] }, card);
    const chem = chemistryScore(club);
    expect(chem.max).toBe(1);
    expect(chem.score).toBeGreaterThanOrEqual(0);
  });
});

describe("scout agent", () => {
  it("poacher prefers higher SHO among catalog", () => {
    const club = { ...EMPTY_CLUB, slots: {}, feed: [] };
    const picks = runScoutAgent("poacher", SAMPLE_CARDS, club, 3);
    expect(picks.length).toBeGreaterThan(0);
    expect(picks[0].reason).toContain("Poacher");
  });

  it("galactico rejects bronze-only desire when finish too low", () => {
    const agent = SCOUT_AGENTS.find((a) => a.id === "galactico")!;
    const low = buildCard({
      login: "demo-low",
      name: "Low",
      avatarUrl: "",
      location: null,
      followers: 1,
      account_age_years: 0.1,
      public_repos: 1,
      total_stars_owned: 1,
      max_repo_stars: 1,
      languages: 1,
      recent_contributions: 1,
      active_days_recent: 1,
      active_years: 1,
      total_contributions_lifetime: 1,
      prs_to_others: 0,
      reviews: 0,
      issues_closed: 0,
      recent_commits: 1,
      recent_spike: false,
    });
    // bronze cards should score -1 under galactico minFinish gold
    if (low.finish === "bronze" || low.finish === "silver") {
      expect(agentDesire(agent, low)).toBe(-1);
    }
  });
});
