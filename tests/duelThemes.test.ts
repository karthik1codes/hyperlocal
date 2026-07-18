import { describe, expect, it } from "vitest";
import { RESULT_THEME, duelThemes } from "@/components/finishTheme";
import type { Card } from "@/lib/scoring/types";
import type { Finish } from "@/lib/scoring/types";

const card = (finish: Finish): Card => ({ finish }) as Card;

describe("duelThemes (kit clash)", () => {
  it("toty/totw now share gold kit — no special clash vs silver", () => {
    expect(duelThemes(card("toty"), card("silver"))).toEqual({
      home: RESULT_THEME.toty,
      away: RESULT_THEME.silver,
    });
    expect(duelThemes(card("totw"), card("silver"))).toEqual({
      home: RESULT_THEME.totw,
      away: RESULT_THEME.silver,
    });
  });

  it("same-tier and gold/icon matchups keep true tier inks", () => {
    expect(duelThemes(card("gold"), card("icon"))).toEqual({
      home: RESULT_THEME.gold,
      away: RESULT_THEME.icon,
    });
    expect(duelThemes(card("gold"), card("gold"))).toEqual({
      home: RESULT_THEME.gold,
      away: RESULT_THEME.gold,
    });
  });
});
