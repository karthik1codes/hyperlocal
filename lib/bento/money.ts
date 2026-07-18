import "server-only";
import { bentoBaseUrl, bentoBuilderHeaders } from "./config";
import type { createBentoSdk } from "@bento.fun/sdk";

type AuthedSdk = ReturnType<typeof createBentoSdk>;

function isAddress(v: unknown): v is string {
  return typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v);
}

export type FaucetStatus = {
  ready: boolean;
  status: string;
  creditsMinterBalance: number;
  usdcMinterBalance: number;
  raw?: unknown;
};

export type MintResult = {
  ok: boolean;
  alreadyFunded?: boolean;
  message?: string;
  status?: number;
};

/** Optional readiness: GET `${BENTO_URL}/bento/auto-mint/status` */
export async function getFaucetStatus(): Promise<FaucetStatus> {
  const base = bentoBaseUrl().replace(/\/$/, "");
  const urls = [
    `${base}/bento/auto-mint/status`,
    ...(base.endsWith("/api")
      ? [`${base.replace(/\/api$/, "")}/bento/auto-mint/status`]
      : []),
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: bentoBuilderHeaders({ Accept: "application/json" }),
      });
      if (!res.ok) continue;
      const raw = (await res.json()) as Record<string, unknown>;
      const credits = Number(raw.creditsMinterBalance ?? raw.credits_minter_balance ?? 0);
      const usdc = Number(raw.minterBalance ?? raw.minter_balance ?? 0);
      return {
        ready: Boolean(raw.isConfigured ?? raw.success ?? true) && (credits > 0 || usdc > 0),
        status: String(raw.status ?? "unknown"),
        creditsMinterBalance: Number.isFinite(credits) ? credits : 0,
        usdcMinterBalance: Number.isFinite(usdc) ? usdc : 0,
        raw,
      };
    } catch {
      /* try next */
    }
  }

  return {
    ready: false,
    status: "unreachable",
    creditsMinterBalance: 0,
    usdcMinterBalance: 0,
  };
}

/**
 * Testnet faucet — docs: register/login does NOT fund you.
 * Empty faucet only blocks *new* funding; accounts that already have credits can still bet.
 * @see https://docs.bento.fun/concepts/money#testnet-faucet-register-does-not-fund-you
 */
export async function mintTestnetCredits(managedAddress: string): Promise<MintResult> {
  if (!isAddress(managedAddress)) {
    return { ok: false, message: "Invalid managed address for faucet mint" };
  }

  const faucet = await getFaucetStatus();
  if (faucet.creditsMinterBalance <= 0 && faucet.usdcMinterBalance <= 0) {
    return {
      ok: false,
      alreadyFunded: false,
      message:
        "Testnet faucet treasury is empty (cannot mint new credits). Existing balances still work.",
      status: 503,
    };
  }

  const base = bentoBaseUrl().replace(/\/$/, "");
  const urls = [
    `${base}/bento/auto-mint/mint`,
    ...(base.endsWith("/api")
      ? [`${base.replace(/\/api$/, "")}/bento/auto-mint/mint`]
      : []),
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: bentoBuilderHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ userAddress: managedAddress }),
      });
      const text = await res.text();
      let body: Record<string, unknown> = {};
      try {
        body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        body = { message: text };
      }

      if (res.ok) {
        return { ok: true, message: stringify(body.message) || "Minted", status: res.status };
      }
      if (res.status === 400 || res.status === 409) {
        const msg = stringify(body.message) || text;
        if (/already|funded|balance|exist/i.test(msg)) {
          return { ok: true, alreadyFunded: true, message: msg, status: res.status };
        }
        return { ok: false, message: msg || `Faucet HTTP ${res.status}`, status: res.status };
      }
      console.warn(`[bento] faucet ${url} → ${res.status}`, text.slice(0, 200));
    } catch (e) {
      console.warn(`[bento] faucet failed:`, (e as Error).message);
    }
  }

  return { ok: false, message: "Faucet mint failed on all endpoints" };
}

function stringify(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function walkForCredits(node: unknown, depth = 0): number | null {
  if (depth > 5 || node == null) return null;
  if (typeof node === "number" && Number.isFinite(node)) {
    return node > 1e15 ? node / 1e18 : node;
  }
  if (typeof node === "string" && node.trim() && Number.isFinite(Number(node))) {
    const n = Number(node);
    return n > 1e15 ? n / 1e18 : n;
  }
  if (typeof node !== "object") return null;
  const o = node as Record<string, unknown>;

  const direct = pickNumber(o, [
    "creditsBalance",
    "creditBalance",
    "availableCredits",
    "freeCredits",
    "playCredits",
    "credits",
    "balanceCredits",
    "creditsAvailable",
  ]);
  if (direct != null) return direct > 1e15 ? direct / 1e18 : direct;

  for (const key of ["credits", "balances", "balance", "wallet", "account", "data", "user"]) {
    if (key in o) {
      const found = walkForCredits(o[key], depth + 1);
      if (found != null) return found;
    }
  }
  return null;
}

/**
 * Best-effort Free-to-Play credits balance on the managed account.
 */
export async function getCreditsBalance(
  sdk: AuthedSdk,
  managedAddress: string,
): Promise<number | null> {
  if (!isAddress(managedAddress)) return null;
  try {
    const raw = (await sdk.user.portfolio.getAccountDetails({
      userAddress: managedAddress,
      collateralStack: "credits",
    })) as Record<string, unknown>;
    return walkForCredits(raw);
  } catch {
    return null;
  }
}

/**
 * Soft preflight — never block solely because the faucet treasury is empty.
 * Users who already have credits must still be able to placeBet.
 */
export async function assertFundedForBet(opts: {
  sdk: AuthedSdk;
  managedAddress?: string;
  units: number;
}): Promise<{ faucet: FaucetStatus; balance: number | null; mint?: MintResult }> {
  const faucet = await getFaucetStatus();
  let mint: MintResult | undefined;
  let balance: number | null = null;

  if (opts.managedAddress) {
    balance = await getCreditsBalance(opts.sdk, opts.managedAddress);

    // Already funded enough — skip mint / ignore empty faucet
    if (balance != null && balance >= opts.units) {
      return { faucet, balance, mint };
    }

    // Only attempt mint when we need more credits
    mint = await mintTestnetCredits(opts.managedAddress);
    balance = await getCreditsBalance(opts.sdk, opts.managedAddress);
  }

  // Hard fail only when we *know* balance is too low
  if (balance != null && balance < opts.units) {
    const faucetHint =
      faucet.creditsMinterBalance <= 0
        ? " Faucet treasury is empty so remint cannot top you up."
        : mint && !mint.ok
          ? ` Faucet: ${mint.message}`
          : "";
    const err = new Error(
      `Insufficient Free-to-Play credits (have ~${balance.toFixed(2)}, need ${opts.units}).${faucetHint}`,
    ) as Error & { type: string };
    err.type = "invalid";
    throw err;
  }

  // balance unknown — do NOT block; let placeBet decide (user may still be funded)
  return { faucet, balance, mint };
}
