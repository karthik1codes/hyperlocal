import "server-only";
import { createBentoSdk, walletAuthProvider } from "@bento.fun/sdk";
import { bentoBaseUrl, bentoBuilderApiKey } from "./config";
import type { ScoutError } from "./client";

/** Shared public SDK (builder key, no user JWT). */
export function getPublicSdk() {
  const apiKey = bentoBuilderApiKey();
  if (!apiKey) {
    const err: ScoutError = {
      type: "config",
      message: "Set BENTO_BUILDER_API_KEY to use sdk.public.",
    };
    throw err;
  }
  return createBentoSdk({
    baseUrl: bentoBaseUrl(),
    apiKey,
    auth: walletAuthProvider(() => ({})),
  }).public;
}

export type PublicProbeRow = {
  name: string;
  ok: boolean;
  ms: number;
  detail?: string;
  error?: string;
};

async function timed(
  name: string,
  fn: () => Promise<unknown>,
  summarize?: (result: unknown) => string,
): Promise<PublicProbeRow> {
  const t0 = Date.now();
  try {
    const result = await fn();
    return {
      name,
      ok: true,
      ms: Date.now() - t0,
      detail: summarize?.(result) ?? summarizeDefault(result),
    };
  } catch (e) {
    return {
      name,
      ok: false,
      ms: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function summarizeDefault(result: unknown): string {
  if (result == null) return "null";
  if (Array.isArray(result)) return `array(${result.length})`;
  if (typeof result === "object") {
    const o = result as Record<string, unknown>;
    if (Array.isArray(o.data)) return `data(${o.data.length})`;
    if (typeof o.total === "number") return `total=${o.total}`;
    return `keys=${Object.keys(o).slice(0, 8).join(",")}`;
  }
  return String(result).slice(0, 80);
}

/**
 * Live smoke-test of every sdk.public surface that can run without a user JWT
 * or interactive weblink confirm.
 */
export async function probePublicSdk(): Promise<{
  baseUrl: string;
  okCount: number;
  failCount: number;
  rows: PublicProbeRow[];
}> {
  const pub = getPublicSdk();
  const rows: PublicProbeRow[] = [];

  // Core market catalog
  rows.push(
    await timed("public.listDuels", () => pub.listDuels({ page: 1, limit: 5, sortBy: "createdAt", sortOrder: "desc" }), (r) => {
      const data = (r as { data?: unknown[] }).data ?? [];
      return `duels=${data.length}`;
    }),
  );
  rows.push(
    await timed("public.listMarkets (alias)", () =>
      pub.listMarkets({ page: 1, limit: 3, sortBy: "createdAt", sortOrder: "desc" }),
    ),
  );

  // Pick a duel id for dependent calls
  let duelId: string | null = null;
  try {
    const list = await pub.listDuels({ page: 1, limit: 1, sortBy: "createdAt", sortOrder: "desc" });
    duelId = list.data?.[0]?.duelId ?? null;
  } catch {
    duelId = null;
  }

  if (duelId) {
    rows.push(
      await timed(`public.getDuelById(${duelId.slice(0, 12)}…)`, () =>
        pub.getDuelById({ duelId: duelId! }),
      ),
    );
    rows.push(
      await timed("public.getMarketById (alias)", () =>
        pub.getMarketById({ marketId: duelId! }),
      ),
    );
    rows.push(await timed("public.getContests", () => pub.getContests(duelId!)));
    rows.push(
      await timed("public.duels.list", () => pub.duels.list({ page: 1, limit: 2 })),
    );
    rows.push(
      await timed("public.duels.getById", () => pub.duels.getById({ duelId: duelId! })),
    );
    rows.push(
      await timed("public.publicBets.getYesPercentageSnapshots", () =>
        pub.publicBets.getYesPercentageSnapshots(duelId!),
      ),
    );
    rows.push(
      await timed("public.publicBets.getSellUnlockLiquidity", () =>
        pub.publicBets.getSellUnlockLiquidity(duelId!),
      ),
    );
  } else {
    rows.push({
      name: "public.getDuelById",
      ok: false,
      ms: 0,
      error: "No duelId from listDuels — skipped dependent calls",
    });
  }

  // Analytics / stats / leaderboard
  rows.push(await timed("public.analytics.getPlatformReport", () => pub.analytics.getPlatformReport()));
  rows.push(await timed("public.protocolStats.getStats", () => pub.protocolStats.getStats()));
  rows.push(await timed("public.protocolStats.getSummary", () => pub.protocolStats.getSummary()));
  rows.push(await timed("public.leaderboard.listCreators", () => pub.leaderboard.listCreators({ limit: 5 })));
  rows.push(await timed("public.leaderboard.listTraders", () => pub.leaderboard.listTraders({ limit: 5 })));
  rows.push(await timed("public.leaderboard.getGlobalAggregate", () => pub.leaderboard.getGlobalAggregate()));
  rows.push(await timed("public.leaderboard.getVolumeChart", () => pub.leaderboard.getVolumeChart()));
  rows.push(await timed("public.leaderboard.getParticipantsChart", () => pub.leaderboard.getParticipantsChart()));

  // Packs
  rows.push(await timed("public.packs.list", () => pub.packs.list({ limit: 5 } as never)));

  // Auth (read-only username check — no signature needed)
  rows.push(
    await timed("public.auth.checkUsername", () =>
      pub.auth.checkUsername({ username: "bento_probe_test_user_xyz" }),
    ),
  );

  // External link — mint URL only (no confirm/exchange)
  rows.push(
    await timed("public.externalLink.getLinkUrl", () =>
      pub.externalLink.getLinkUrl({
        returnUrl: "http://127.0.0.1:3000/auth/callback",
        state: "probe",
      }),
    ),
  );

  // Withdrawal daily limit (often public)
  rows.push(
    await timed("public.withdrawalRequests.getDailyLimit", () =>
      pub.withdrawalRequests.getDailyLimit({}),
    ),
  );

  // Parent markets — listAccessible needs an address; use zero address as probe
  rows.push(
    await timed("public.parentMarkets.listAccessible(0x0…)", () =>
      pub.parentMarkets.listAccessible("0x0000000000000000000000000000000000000001"),
    ),
  );

  // Portfolio positions for a dummy address (public-shaped read)
  rows.push(
    await timed("public.portfolio.getPositions(dummy)", () =>
      pub.portfolio.getPositions("0x0000000000000000000000000000000000000001"),
    ),
  );

  // Invitations — validate with nonsense code (expect graceful fail or empty)
  rows.push(
    await timed("public.duelInvitations.getByInviteCode(probe)", () =>
      pub.duelInvitations.getByInviteCode("probe-invalid-code"),
    ),
  );

  const okCount = rows.filter((r) => r.ok).length;
  const failCount = rows.length - okCount;
  return { baseUrl: bentoBaseUrl(), okCount, failCount, rows };
}
