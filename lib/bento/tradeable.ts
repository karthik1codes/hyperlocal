/**
 * Shared tradeability checks for Bento credits markets.
 * endsIn from the API is seconds remaining (see samples: 86400 * N).
 */

export function isOpenMarketStatus(status: unknown): boolean {
  const s = Number(status);
  // 0 / 1 = open-ish on testnet; negatives (e.g. -1) and >=2 are not placeable
  return s === 0 || s === 1;
}

/** Minimum seconds of runway before we attempt placeBet (avoids flaky late 500s). */
export const MIN_PLACE_ENDS_IN_SECONDS = 60;

export function endsInSeconds(endsIn: unknown): number {
  const n = Number(endsIn);
  return Number.isFinite(n) ? n : 0;
}

export function isMarketTradeable(input: {
  status?: unknown;
  endsIn?: unknown;
  duelType?: unknown;
}): { ok: true } | { ok: false; reason: string } {
  const status = Number(input.status ?? 0);
  if (!isOpenMarketStatus(status)) {
    return {
      ok: false,
      reason:
        status < 0
          ? `This market is paused or invalid on Bento (status=${status}). Pick another live credits market from the home fan.`
          : `This market is not open for bets (status=${status}). Pick an active market from the home fan.`,
    };
  }

  const ends = endsInSeconds(input.endsIn);
  if (ends <= 0) {
    return { ok: false, reason: "This market has already ended." };
  }
  if (ends < MIN_PLACE_ENDS_IN_SECONDS) {
    return {
      ok: false,
      reason: `This market is about to expire (endsIn=${ends}s). Late bets usually fail with HTTP 500 on testnet — pick a market with more time left.`,
    };
  }

  const t = String(input.duelType || "").toLowerCase();
  if (t && t !== "prediction" && t !== "versus") {
    return { ok: false, reason: `Unsupported market type “${t}”.` };
  }

  return { ok: true };
}
