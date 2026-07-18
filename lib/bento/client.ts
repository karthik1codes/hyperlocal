import "server-only";
import { createBentoSdk, walletAuthProvider, type PublicDuelDetail, type PublicDuelSummary } from "@bento.fun/sdk";
import { bentoBaseUrl, bentoBuilderApiKey } from "./config";

export type ScoutErrorType = "invalid" | "notfound" | "ratelimit" | "network" | "config";

export interface ScoutError {
  type: ScoutErrorType;
  message: string;
}

export type BentoDuel = PublicDuelSummary | PublicDuelDetail;

const VALID_ID = /^[a-zA-Z0-9_-]{1,128}$/;

export function normalizeMarketId(raw: string): string {
  return raw.trim().replace(/^@/, "");
}

export function isValidMarketId(id: string): boolean {
  return VALID_ID.test(id);
}

function publicSdk() {
  const apiKey = bentoBuilderApiKey();
  if (!apiKey) {
    const err: ScoutError = {
      type: "config",
      message: "Bento is not configured. Set BENTO_BUILDER_API_KEY to scout live markets.",
    };
    throw err;
  }
  return createBentoSdk({
    baseUrl: bentoBaseUrl(),
    apiKey,
    auth: walletAuthProvider(() => ({})),
  });
}

/** Prefer this when you only need sdk.public (catalog, packs, leaderboard, …). */
export { getPublicSdk } from "./public-api";
export { probePublicSdk } from "./public-api";

export function authedSdk(token: string) {
  const apiKey = bentoBuilderApiKey();
  if (!apiKey) {
    const err: ScoutError = { type: "config", message: "Bento is not configured." };
    throw err;
  }
  return createBentoSdk({
    baseUrl: bentoBaseUrl(),
    apiKey,
    auth: walletAuthProvider(() => ({ Authorization: `Bearer ${token}` })),
  });
}

function mapSdkError(e: unknown): ScoutError {
  const msg = e instanceof Error ? e.message : String(e);
  const lower = msg.toLowerCase();
  if (lower.includes("404") || lower.includes("not found")) {
    return { type: "notfound", message: msg };
  }
  if (lower.includes("429") || lower.includes("rate")) {
    return { type: "ratelimit", message: msg };
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return { type: "network", message: msg };
  }
  return { type: "network", message: msg };
}

/**
 * List live public markets via sdk.public.listDuels (Bento markets host).
 * @see https://docs.bento.fun/typescript-sdk#sdkpublic-markets-host
 */
export async function listMarkets(limit = 8): Promise<PublicDuelSummary[]> {
  try {
    const sdk = publicSdk();
    const pageSize = Math.min(100, Math.max(limit * 6, 40));

    // Prefer Free-to-Play credits markets (not Pro / USDC).
    let rows: PublicDuelSummary[] = [];
    try {
      const byVol = await sdk.public.listDuels({
        page: 1,
        limit: pageSize,
        sortBy: "polymarketVolume24h",
        sortOrder: "desc",
        collateralStack: "credits",
      });
      rows = byVol.data ?? [];
    } catch {
      try {
        const byDate = await sdk.public.listDuels({
          page: 1,
          limit: pageSize,
          sortBy: "createdAt",
          sortOrder: "desc",
          collateralStack: "credits",
        });
        rows = byDate.data ?? [];
      } catch {
        const fallback = await sdk.public.listDuels({
          page: 1,
          limit: pageSize,
          sortBy: "createdAt",
          sortOrder: "desc",
        });
        rows = (fallback.data ?? []).filter(
          (d) => String(d.collateralMode || "credits").toLowerCase() !== "usdc",
        );
      }
    }

    const playable = rows.filter((d) => {
      const t = String(d.duelType || "").toLowerCase();
      if (t !== "prediction" && t !== "versus") return false;
      const ends = Number(d.endsIn ?? 0);
      // Skip markets that are already over / instantly expiring — they 500 on placeBet
      if (Number.isFinite(ends) && ends <= 0.05) return false;
      const title = String(d.betString || d.options?.[0] || "").trim();
      // Drop placeholder / junk catalog rows that clutter the markets fan
      if (title.length < 12) return false;
      if (/^will\s+dependency\b/i.test(title)) return false;
      if (/^dependency\b/i.test(title)) return false;
      if (/^(test|demo|asdf|xxx|qa)\b/i.test(title)) return false;
      if (/\[demo/i.test(title)) return false;
      if (/\bqa lifecycle\b/i.test(title)) return false;
      if (/terminator_\d/i.test(title)) return false;
      if (/^i will make \d/i.test(title)) return false;
      if (/lorem ipsum/i.test(title)) return false;
      if (/swipebet/i.test(title)) return false;
      if (/pre-start betting/i.test(title)) return false;
      if (/will team a beat team b/i.test(title)) return false;
      return true;
    });

    // Prefer prediction + longer runway (versus + tiny endsIn often 500 on testnet)
    const preferred = playable
      .map((d) => {
        const ends = Number(d.endsIn ?? 0);
        const isPred = String(d.duelType || "").toLowerCase() === "prediction";
        const title = String(d.betString || "");
        const uniqueBoost = /dependency/i.test(title) ? -1e9 : 0;
        const score =
          Number(d.totalBetAmountUsdc ?? d.totalBetAmountUSDC ?? d.totalBetAmount ?? 0) +
          (isPred ? 1e6 : 0) +
          Math.min(ends, 200) * 100 +
          uniqueBoost;
        return { d, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((x) => x.d);

    // Deduplicate near-identical titles so the fan isn't 6× the same market
    const unique: PublicDuelSummary[] = [];
    const seenTitles = new Set<string>();
    for (const d of preferred) {
      const key = String(d.betString || d.duelId)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .slice(0, 48);
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);
      unique.push(d);
      if (unique.length >= limit * 2) break;
    }

    const sports = unique.filter((d) => {
      const cat = `${d.category || ""} ${(d.tags || []).join(" ")}`.toLowerCase();
      return /sport|soccer|football|fifa|epl|ucl|premier|world.?cup|nba|nfl/i.test(cat);
    });

    return (sports.length >= Math.min(3, limit) ? sports : unique).slice(0, limit);
  } catch (e) {
    console.error("[bento] listMarkets failed:", (e as Error).message);
    throw mapSdkError(e);
  }
}

/** Fetch a single market by on-chain duelId (pass userAddress for private markets). */
export async function fetchMarket(
  duelIdRaw: string,
  opts?: { userAddress?: string; inviteCode?: string },
): Promise<BentoDuel> {
  const duelId = normalizeMarketId(duelIdRaw);
  if (!isValidMarketId(duelId)) {
    const err: ScoutError = {
      type: "invalid",
      message: `"${duelIdRaw}" isn't a valid market id.`,
    };
    throw err;
  }
  try {
    const sdk = publicSdk();
    return await sdk.public.getDuelById({
      duelId,
      ...(opts?.inviteCode ? { inviteCode: opts.inviteCode } : {}),
      // SDK query builder reads userAddress for private/creator access
      ...(opts?.userAddress
        ? ({ userAddress: opts.userAddress } as { userAddress: string })
        : {}),
    } as Parameters<typeof sdk.public.getDuelById>[0]);
  } catch (e) {
    const mapped = mapSdkError(e);
    if (mapped.type === "notfound") {
      mapped.message = `There's no Bento market named ${duelId}.`;
    }
    throw mapped;
  }
}
