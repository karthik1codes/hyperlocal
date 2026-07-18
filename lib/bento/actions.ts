import "server-only";
import { authedSdk, fetchMarket, type ScoutError } from "./client";
import { DEFAULT_COLLATERAL, bentoBaseUrl } from "./config";
import { assertFundedForBet, mintTestnetCredits } from "./money";

export type BentoAuthSession = {
  token: string;
  exists: boolean;
  signingAddress: string;
  managedAddress: string | null;
  username: string | null;
  faucetMinted?: boolean;
};

function isAddress(v: unknown): v is string {
  return typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v);
}

function pickManagedAddress(res: Record<string, unknown>, signing: string): string | null {
  const candidates = [
    res.alchemyAddress,
    res.alchemy_address,
    res.managedAddress,
    res.managed_address,
    res.accountAddress,
    res.account_address,
    (res.user as Record<string, unknown> | undefined)?.alchemyAddress,
    (res.account as Record<string, unknown> | undefined)?.address,
    (res.wallet as Record<string, unknown> | undefined)?.address,
    (res.user as Record<string, unknown> | undefined)?.address,
  ];
  for (const c of candidates) {
    if (isAddress(c) && c.toLowerCase() !== signing.toLowerCase()) return c;
  }
  for (const c of candidates) {
    if (isAddress(c)) return c;
  }
  return null;
}

function pickUsername(res: Record<string, unknown>): string | null {
  const u =
    res.username ??
    (res.user as Record<string, unknown> | undefined)?.username ??
    (res.user as Record<string, unknown> | undefined)?.auth0Username;
  return typeof u === "string" && u.length ? u : null;
}

/** Unpack BentoSdkErrorException / Nest / ScoutError into a readable string. */
export function formatBentoError(e: unknown): string {
  if (e == null) return "Unknown error";

  // Our thrown ScoutError plain objects → were showing as [object Object]
  if (typeof e === "object" && e !== null && "message" in e && !("sdkError" in e)) {
    const msg = (e as { message?: unknown; type?: unknown }).message;
    const type = (e as { type?: unknown }).type;
    const text = stringifyMsg(msg);
    if (text) {
      return typeof type === "string" && type.length ? `${text} (${type})` : text;
    }
  }

  if (e && typeof e === "object" && "sdkError" in e) {
    const sdk = (e as { sdkError: Record<string, unknown> }).sdkError;
    const parts: string[] = [];
    const text = stringifyMsg(sdk.message);
    if (text) parts.push(text);
    if (typeof sdk.code === "string" && sdk.code) parts.push(`code=${sdk.code}`);
    if (typeof sdk.status === "number") parts.push(`HTTP ${sdk.status}`);
    if (sdk.details != null) {
      const d = stringifyMsg(sdk.details);
      if (d && d !== "{}" && d !== "null") parts.push(d.slice(0, 280));
    }
    if (parts.length) return parts.join(" — ");
  }

  if (e instanceof Error) {
    const text = stringifyMsg(e.message);
    if (text && text !== "[object Object]") return text;
  }

  return stringifyMsg(e) || "Bet failed";
}

function stringifyMsg(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    return v.map(stringifyMsg).filter(Boolean).join("; ");
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    if (Array.isArray(o.message)) return stringifyMsg(o.message);
    if (typeof o.error === "string") return o.error;
    if (typeof o.error === "object" && o.error) return stringifyMsg(o.error);
    try {
      return JSON.stringify(v);
    } catch {
      return "";
    }
  }
  return String(v);
}

function throwScout(type: ScoutError["type"], message: string): never {
  const err = new Error(message) as Error & ScoutError;
  err.type = type;
  err.message = message;
  throw err;
}

/** Re-export faucet helper (returns MintResult — use `.ok`). */
export { mintTestnetCredits, getFaucetStatus, getCreditsBalance } from "./money";

export async function loginOrRegister(input: {
  address: string;
  signature: string;
  timestamp: string;
  username?: string;
}): Promise<BentoAuthSession> {
  const { createBentoSdk, walletAuthProvider } = await import("@bento.fun/sdk");
  const { bentoBuilderApiKey } = await import("./config");
  const apiKey = bentoBuilderApiKey();
  if (!apiKey) {
    throwScout("config", "Bento is not configured.");
  }
  const publicSdk = createBentoSdk({
    baseUrl: bentoBaseUrl(),
    apiKey,
    auth: walletAuthProvider(() => ({})),
  });

  let res = (await publicSdk.public.auth.eoaLogin({
    address: input.address,
    signature: input.signature,
    timestamp: input.timestamp,
  })) as Record<string, unknown>;

  let registered = false;
  if (!res.exists || !res.token) {
    const username =
      input.username ||
      `bento_${input.address.slice(2, 8).toLowerCase()}_${Date.now().toString(36).slice(-4)}`;
    res = (await publicSdk.public.auth.eoaRegister({
      address: input.address,
      signature: input.signature,
      timestamp: input.timestamp,
      username,
    })) as Record<string, unknown>;
    registered = true;
  }

  const token = res.token;
  if (typeof token !== "string" || !token) {
    throwScout("network", "Bento login did not return a token.");
  }

  const managedAddress = pickManagedAddress(res, input.address);
  const mintAddr = managedAddress || input.address;
  const mint = await mintTestnetCredits(mintAddr);

  return {
    token,
    exists: !registered && Boolean(res.exists),
    signingAddress: input.address,
    managedAddress,
    username: pickUsername(res) || input.username || null,
    faucetMinted: mint.ok,
  };
}

/**
 * Option label for placeBet — docs:
 * `YES` / `NO` for prediction, the optionA / optionB **text** for versus.
 * @see https://docs.bento.fun/guides/place-bet
 */
function resolveBetLabel(
  duel: { options?: string[]; duelType?: string },
  optionIndex: 0 | 1,
  clientLabel?: string,
): string {
  const rawType = String(duel.duelType || "").toLowerCase();
  if (rawType === "versus") {
    const fromDuel = duel.options?.[optionIndex]?.trim();
    if (fromDuel) return fromDuel;
    if (clientLabel?.trim()) return clientLabel.trim();
    return optionIndex === 0 ? "optionA" : "optionB";
  }
  // Prediction markets: platform expects exact YES / NO
  return optionIndex === 0 ? "YES" : "NO";
}

/**
 * Docs flow:
 * estimateBuy → placeBetFromEstimate → getUserShares
 * @see https://docs.bento.fun/guides/place-bet
 */
export async function estimateAndPlaceBet(input: {
  token: string;
  duelId: string;
  optionIndex: 0 | 1;
  amount: string;
  duelType?: string;
  optionLabel?: string;
  slippageBps?: number;
  address?: string;
  collateralMode?: "credits" | "usdc";
}) {
  const sdk = authedSdk(input.token);
  const { parseUnits } = await import("viem");

  // Whole units only — avoid float wei drift
  const units = Math.floor(Number(String(input.amount).trim()));
  if (!Number.isFinite(units) || units < 5) {
    throwScout(
      "invalid",
      "Minimum bet is 5 collateral units (estimateBuy does not enforce this — placement 500s below 5).",
    );
  }

  const duel = await fetchMarket(input.duelId, { userAddress: input.address }).catch((e) => {
    throwScout("notfound", `Could not load market ${input.duelId}: ${formatBentoError(e)}`);
  });

  const { isMarketTradeable } = await import("./tradeable");
  const tradeable = isMarketTradeable({
    status: duel.status,
    endsIn: duel.endsIn,
    duelType: duel.duelType,
  });
  if (!tradeable.ok) {
    throwScout("invalid", tradeable.reason);
  }

  const status = Number(duel.status ?? 0);
  const endsIn = Number(duel.endsIn ?? 0);

  const startRaw = Number(duel.startAt ?? duel.startTime ?? 0);
  if (startRaw > 0) {
    const startMs = startRaw < 1e12 ? startRaw * 1000 : startRaw;
    const waitMs = startMs - Date.now();
    // Short waits: hold the request. Longer waits: tell the client to retry after open
    // (Bento createDuel requires a future startTime — often ~30 min).
    if (waitMs > 120_000) {
      const mins = Math.ceil(waitMs / 60_000);
      const err = {
        type: "invalid" as const,
        message: `Market not open yet — opens in ~${mins} min.`,
        code: "MARKET_NOT_STARTED",
        opensInMs: waitMs,
        opensAt: startMs,
      };
      throw err;
    }
    if (waitMs > 0) {
      await new Promise((r) => setTimeout(r, waitMs + 2_500));
    }
  }

  const marketMode =
    duel.collateralMode === "usdc" || input.collateralMode === "usdc" ? "usdc" : "credits";
  const collateralMode = marketMode === "usdc" ? "usdc" : DEFAULT_COLLATERAL;

  if (collateralMode === "usdc") {
    throwScout(
      "invalid",
      "This is a Pro (USDC) market. Open a Free-to-Play / credits market — this app stakes credits only.",
    );
  }

  // Credits / BSC USDC = 18 decimals (docs). Stake in wei, e.g. 10 units.
  const tokenDecimals = 18;
  const stake = parseUnits(String(units), tokenDecimals).toString();
  const slippageBps = input.slippageBps ?? 100;

  const rawType = String(duel.duelType || input.duelType || "prediction").toLowerCase();
  const isVersus = rawType === "versus";
  const duelType = isVersus ? "VERSUS" : "PREDICTION";

  const primaryBet = resolveBetLabel(duel, input.optionIndex, input.optionLabel);
  // Versus fallback if backend expects literal optionA/optionB keys
  const versusAlt = input.optionIndex === 0 ? "optionA" : "optionB";
  const betCandidates = isVersus
    ? [...new Set([primaryBet, versusAlt].filter(Boolean))]
    : [primaryBet];

  // Soft funding check — never block if faucet is empty but account already has credits
  try {
    await assertFundedForBet({
      sdk,
      managedAddress: input.address,
      units,
    });
  } catch (e) {
    const msg =
      e instanceof Error && e.message
        ? e.message
        : formatBentoError(e);
    const type =
      e && typeof e === "object" && "type" in e && typeof (e as ScoutError).type === "string"
        ? (e as ScoutError).type
        : "invalid";
    throwScout(type, msg);
  }

  const placeOnce = async (bet: string) => {
    // 1. Estimate — amount is collateral wei; estimateBuy does NOT enforce the 5-unit floor
    const est = await sdk.user.bets.estimateBuy({
      duelId: duel.duelId,
      optionIndex: input.optionIndex,
      betAmountUsdc: stake,
      slippageBps,
    });

    if (!est.success) {
      const why =
        stringifyMsg((est as { error?: unknown }).error) || "estimate rejected";
      throwScout(
        "invalid",
        `Estimate failed for this market: ${why}. This market may not be tradeable (timing/status) even if other markets work.`,
      );
    }

    // 2. Place via placeBetFromEstimate
    const idempotencyKey = crypto.randomUUID();
    const placed = await sdk.user.placeBetFromEstimate(
      {
        estimate: est.estimate,
        duelId: duel.duelId,
        duelType,
        bet,
        optionIndex: input.optionIndex,
        betAmount: stake,
        betAmountUsdc: stake,
        slippageBps,
        collateralMode,
        tokenDecimals,
      },
      { idempotencyKey },
    );

    return { estimate: est.estimate, placed, bet, duelType, idempotencyKey };
  };

  let result: Awaited<ReturnType<typeof placeOnce>> | undefined;
  let lastErr = "";

  for (const bet of betCandidates) {
    try {
      result = await placeOnce(bet);
      break;
    } catch (e) {
      lastErr = formatBentoError(e);
      // Strip duplicate type suffixes for cleaner retries
      lastErr = lastErr.replace(/\s*\(config\)\s*$/i, "").replace(/\s*\(invalid\)\s*$/i, "");
      if (/insufficient/i.test(lastErr) && input.address) {
        await mintTestnetCredits(input.address);
        try {
          result = await placeOnce(bet);
          break;
        } catch (e2) {
          lastErr = formatBentoError(e2).replace(/\s*\((config|invalid|network)\)\s*$/i, "");
        }
      }
      // Try next versus label on opaque 500 / unable to place
      if (!isVersus || !/unable to place bet|500|slippage/i.test(lastErr)) {
        break;
      }
    }
  }

  if (!result) {
    const marketHint =
      endsIn < 1
        ? " Market is nearly expired (low endsIn)."
        : isVersus
          ? " Some VERSUS markets 500 on place even when PREDICTION works — try a PREDICTION credits market."
          : " This specific market may be paused/untradeable on testnet.";
    throwScout(
      "network",
      /unable to place bet|estimate failed/i.test(lastErr)
        ? `${lastErr} [duel=${duel.duelId.slice(0, 12)}… type=${duelType} bet=${betCandidates.map((b) => `"${b}"`).join("|")} option=${input.optionIndex} stake=${units} status=${status} endsIn=${endsIn}].${marketHint}`
        : lastErr || "Bet failed",
    );
  }

  // 3. Reconcile — field is `address`, not `walletAddress`
  let shares: unknown = null;
  if (input.address) {
    try {
      shares = await sdk.user.bets.getUserShares({
        duelId: duel.duelId,
        address: input.address,
      });
    } catch {
      /* acceptance ≠ finality */
    }
  }

  return {
    ...result,
    shares,
    stake,
    units,
    collateral: collateralMode,
    options: duel.options,
    marketStatus: status,
  };
}

export type UserBetRow = {
  duelId: string;
  question: string;
  side: string;
  stake: number | null;
  shares: number | null;
  value: number | null;
  pnl: number | null;
  status: string;
  category: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  const o = asRecord(v);
  if (!o) return [];
  for (const key of ["data", "positions", "rows", "items", "duels", "bets", "open", "result"]) {
    if (Array.isArray(o[key])) return o[key] as unknown[];
  }
  // Nested table shape: { openBets: [...] } etc.
  for (const val of Object.values(o)) {
    if (Array.isArray(val) && val.length && typeof val[0] === "object") return val;
  }
  return [];
}

function numish(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function strish(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function normalizeBetRow(raw: unknown): UserBetRow | null {
  const r = asRecord(raw);
  if (!r) return null;

  const duel =
    asRecord(r.duel) ||
    asRecord(r.market) ||
    asRecord(r.bentoDuel) ||
    null;

  const duelId =
    strish(r.duelId) ||
    strish(r.marketId) ||
    strish(r.id) ||
    strish(duel?.duelId) ||
    strish(duel?.id);
  if (!duelId) return null;

  const question =
    strish(r.question) ||
    strish(r.title) ||
    strish(r.name) ||
    strish(duel?.question) ||
    strish(duel?.title) ||
    `Market ${duelId.slice(0, 10)}…`;

  const side =
    strish(r.side) ||
    strish(r.bet) ||
    strish(r.option) ||
    strish(r.outcome) ||
    strish(r.position) ||
    (typeof r.optionIndex === "number"
      ? r.optionIndex === 0
        ? "YES"
        : "NO"
      : null) ||
    "—";

  const stake =
    numish(r.stake) ??
    numish(r.betAmount) ??
    numish(r.betAmountUsdc) ??
    numish(r.amount) ??
    numish(r.cost) ??
    numish(r.invested);

  const shares =
    numish(r.shares) ??
    numish(r.shareBalance) ??
    numish(r.quantity) ??
    numish(r.yesShares) ??
    numish(r.noShares);

  const value =
    numish(r.currentValue) ??
    numish(r.value) ??
    numish(r.valuation) ??
    numish(r.markValue);

  const pnl =
    numish(r.unrealizedPnl) ??
    numish(r.pnl) ??
    numish(r.unrealisedPnl) ??
    numish(r.profit);

  const status =
    strish(r.status) ||
    strish(r.state) ||
    (r.resolved === true || r.settled === true ? "settled" : "open");

  const category =
    strish(r.category) || strish(duel?.category) || strish(r.collateralStack) || null;

  return {
    duelId,
    question,
    side: String(side).toUpperCase(),
    stake,
    shares,
    value,
    pnl,
    status,
    category,
  };
}

/**
 * Open + recent bets for the logged-in managed wallet.
 * Tries positions → open-bets table → history.
 */
export async function listUserBets(input: {
  token: string;
  address: string;
}): Promise<{ bets: UserBetRow[]; source: string }> {
  const sdk = authedSdk(input.token);
  const addr = input.address;
  const body = { userAddress: addr, collateralStack: "credits" as const };

  const attempts: Array<{ source: string; run: () => Promise<unknown> }> = [
    {
      source: "positions",
      run: () => sdk.user.portfolio.getPositions(addr, { collateralStack: "credits" }),
    },
    {
      source: "table/duels",
      run: () => sdk.user.portfolio.getDuelsTable(body),
    },
    {
      source: "table/history",
      run: () => sdk.user.portfolio.getHistoryTable(body),
    },
    {
      source: "accountDetails",
      run: () => sdk.user.portfolio.getAccountDetails(body),
    },
  ];

  let lastErr = "";
  for (const a of attempts) {
    try {
      const raw = await a.run();
      const rows = asArray(raw)
        .map(normalizeBetRow)
        .filter((x): x is UserBetRow => Boolean(x));
      if (rows.length || a.source === "positions") {
        return { bets: rows, source: a.source };
      }
    } catch (e) {
      lastErr = formatBentoError(e);
      console.warn(`[bets] ${a.source}:`, lastErr);
    }
  }

  if (lastErr) {
    throwScout("network", `Could not load bets: ${lastErr}`);
  }
  return { bets: [], source: "none" };
}

export async function createVersusMarket(input: {
  token: string;
  optionA: string;
  optionB: string;
  question?: string;
  category?: string;
  description?: string;
}) {
  const sdk = authedSdk(input.token);
  const start = Date.now() + 31 * 60_000;
  const question =
    input.question || `Who wins: ${input.optionA} vs ${input.optionB}?`;

  return sdk.user.createDuel(
    {
      question,
      type: "versus",
      category: toBentoDuelCategory(input.category || "Sports"),
      description: input.description || `Versus market: ${input.optionA} vs ${input.optionB}`,
      optionA: input.optionA,
      optionB: input.optionB,
      startTime: new Date(start).toISOString(),
      endTime: new Date(start + 2 * 3600_000).toISOString(),
      privacyAccess: "public",
      collateralMode: DEFAULT_COLLATERAL,
      tags: ["bento", "versus"],
    },
    { requestId: `vs-${Date.now()}` },
  );
}

/**
 * Bento `createDuel` only accepts sport categories (Cricket, Football, …) —
 * not Hyper-Local / Politics / Transit. We map into an allowed sport for the API
 * and keep the real topic in description/tags.
 */
export const BENTO_DUEL_CATEGORIES = [
  "Cricket",
  "Football",
  "Basketball",
  "American Football",
  "Tennis",
  "Baseball",
  "Hockey",
  "Formula 1",
] as const;

export type BentoDuelCategory = (typeof BENTO_DUEL_CATEGORIES)[number];

/** Map our card labels onto a category Bento will accept on createDuel. */
export function toBentoDuelCategory(raw?: string | null): BentoDuelCategory {
  const s = (raw || "").trim().toLowerCase();
  if (!s) return "Cricket";
  for (const c of BENTO_DUEL_CATEGORIES) {
    if (c.toLowerCase() === s) return c;
  }
  // Loose aliases from Gemini / local drafts
  if (/soccer|premier|laliga|uefa|fifa/.test(s)) return "Football";
  if (/nba|ncaa|basket/.test(s)) return "Basketball";
  if (/nfl|super ?bowl/.test(s)) return "American Football";
  if (/atp|wta|wimbledon|grand slam/.test(s)) return "Tennis";
  if (/mlb|world series/.test(s)) return "Baseball";
  if (/nhl|ice hockey/.test(s)) return "Hockey";
  if (/f1|formula|grand prix|motorsport/.test(s)) return "Formula 1";
  if (/cricket|ipl|t20|test match/.test(s)) return "Cricket";
  // Hyper-local / politics / transit / campus / etc. — platform enum is sports-only
  return "Cricket";
}

/**
 * Mint a YES/NO credits prediction (hyper-local → live bets).
 *
 * Bento rules:
 * - startTime ≥ ~5 min (on-chain floor). Near-floor values can pass HTTP then
 *   revert → HTTP 500 "Pre-flight simulation failed".
 * - Public markets need ~30 min bootstrap or they get cancelled.
 * - Private markets skip bootstrap → ~6 min is enough for create + bet.
 *
 * Override with BENTO_MARKET_OPEN_DELAY_MS (clamped to ≥ 6 min).
 */
export async function createPredictionMarket(input: {
  token: string;
  question: string;
  category?: string;
  description?: string;
  /** Market lifetime in days (default 90). */
  deadlineDays?: number;
  tags?: string[];
  coverImageUrl?: string;
}) {
  const sdk = authedSdk(input.token);
  const days = Math.max(1, Math.min(365, Math.floor(input.deadlineDays ?? 90)));
  const ONCHAIN_FLOOR_MS = 5 * 60_000;
  const SAFE_PRIVATE_MS = ONCHAIN_FLOOR_MS + 60_000; // 6 min — above floor
  const envDelay = Number(process.env.BENTO_MARKET_OPEN_DELAY_MS);
  const OPEN_DELAY_MS = Math.max(
    SAFE_PRIVATE_MS,
    Number.isFinite(envDelay) && envDelay > 0 ? envDelay : SAFE_PRIVATE_MS,
  );
  const question = input.question.trim().slice(0, 200);
  if (question.length < 8) {
    throwScout("invalid", "Prediction question is too short.");
  }

  const category = toBentoDuelCategory(input.category);
  const originalCat = (input.category || "").trim();
  const descriptionBits = [
    (input.description || question).slice(0, 1800),
    originalCat && toBentoDuelCategory(originalCat) !== originalCat
      ? `Local category: ${originalCat}`
      : null,
  ].filter(Boolean);

  const buildBody = (
    startMs: number,
    endMs: number,
    privacy: "private" | "public",
  ) => ({
    question,
    type: "prediction" as const,
    category,
    description: descriptionBits.join("\n\n").slice(0, 2000),
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(endMs).toISOString(),
    privacyAccess: privacy,
    collateralMode: DEFAULT_COLLATERAL,
    tags: input.tags?.length ? input.tags : ["bento", "hyper-local", "prediction"],
    ...(input.coverImageUrl ? { coverImageUrl: input.coverImageUrl } : {}),
  });

  let usedDelay = OPEN_DELAY_MS;
  let usedStart = Date.now() + OPEN_DELAY_MS;
  let usedEnd = usedStart + days * 86_400_000;
  let privacy: "private" | "public" = "private";
  let result: Awaited<ReturnType<typeof sdk.user.createDuel>>;

  const attempt = async (delayMs: number, access: "private" | "public") => {
    usedDelay = delayMs;
    usedStart = Date.now() + delayMs;
    usedEnd = usedStart + days * 86_400_000;
    privacy = access;
    return sdk.user.createDuel(buildBody(usedStart, usedEnd, access), {
      requestId: `pred-${Date.now()}-${access}`,
    });
  };

  const needsRetry = (msg: string) =>
    /pre-flight|simulation failed|start time|must be in the future|too soon/i.test(msg);

  try {
    result = await attempt(OPEN_DELAY_MS, "private");
  } catch (e) {
    const msg = formatBentoError(e);
    if (!needsRetry(msg)) throw e;
    try {
      // Bump further above the floor
      result = await attempt(8 * 60_000, "private");
    } catch (e2) {
      const msg2 = formatBentoError(e2);
      if (!needsRetry(msg2)) throw e2;
      // Last resort: public bootstrap window
      result = await attempt(31 * 60_000, "public");
    }
  }

  return {
    ...result,
    startAt: usedStart,
    endAt: usedEnd,
    opensInMs: usedDelay,
    privacyAccess: privacy,
  };
}

export type BetEstimateQuote = {
  duelId: string;
  optionIndex: 0 | 1;
  units: number;
  sharesOut: number;
  avgPrice: number;
  yesPrice: number;
  noPrice: number;
  /** Decimal odds ≈ 1 / avg price paid. */
  odds: number;
  /** Expected credits if this side wins (≈ shares). */
  payoutIfWin: number;
  priceImpact: number;
  quoteId?: string;
};

/** Quote only — estimateBuy without placing. */
export async function estimateBetQuote(input: {
  token: string;
  duelId: string;
  optionIndex: 0 | 1;
  amount: string;
  address?: string;
}): Promise<BetEstimateQuote> {
  const sdk = authedSdk(input.token);
  const { parseUnits } = await import("viem");

  const units = Math.floor(Number(String(input.amount).trim()));
  if (!Number.isFinite(units) || units < 5) {
    throwScout("invalid", "Minimum bet is 5 credits for an estimate.");
  }
  if (input.duelId.startsWith("local-") || input.duelId.startsWith("demo-") || input.duelId.startsWith("pm-")) {
    throwScout("invalid", "Open this card as a live Bento prediction before quoting odds.");
  }

  let duel: Awaited<ReturnType<typeof fetchMarket>>;
  try {
    duel = await fetchMarket(input.duelId, { userAddress: input.address });
  } catch (e) {
    throwScout("notfound", `Could not load market ${input.duelId}: ${formatBentoError(e)}`);
  }

  const stake = parseUnits(String(units), 18).toString();
  const est = await sdk.user.bets.estimateBuy({
    duelId: duel.duelId,
    optionIndex: input.optionIndex,
    betAmountUsdc: stake,
    slippageBps: 100,
  });

  if (!est.success) {
    const why = stringifyMsg((est as { error?: unknown }).error) || "estimate rejected";
    throwScout("invalid", `Estimate failed: ${why}`);
  }

  const e = est.estimate;
  const sharesOut = Number(e.shares_out) || 0;
  const avgPrice = Number(e.avg_price_paid) || 0;
  const odds = avgPrice > 0 ? 1 / avgPrice : 0;

  return {
    duelId: duel.duelId,
    optionIndex: input.optionIndex,
    units,
    sharesOut,
    avgPrice,
    yesPrice: Number(e.current_yes_price) || 0,
    noPrice: Number(e.current_no_price) || 0,
    odds,
    payoutIfWin: sharesOut,
    priceImpact: Number(e.price_impact) || 0,
    quoteId: e.quote_id,
  };
}
