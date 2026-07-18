"use client";

import type { useBentoWallet } from "@/hooks/useBentoWallet";

type Wallet = ReturnType<typeof useBentoWallet>;

/**
 * Bento weblink session — JWT + managed account + Free-to-Play credits.
 */
export default function WalletSession({
  wallet,
  accent = "brand",
  compact = false,
}: {
  wallet: Wallet;
  accent?: "brand" | "gold";
  compact?: boolean;
}) {
  const {
    isLoggedIn,
    signingAddress,
    managedAddress,
    username,
    busy,
    phaseLabel,
    error,
    shortAddr,
    connectAndLogin,
    logout,
  } = wallet;

  const btn =
    accent === "gold"
      ? "border-gold/45 bg-gold/10 text-gold-hi hover:bg-gold/20"
      : "bg-brand text-[#04130a] hover:bg-brand-hi";

  if (!isLoggedIn) {
    return (
      <div className={compact ? "" : "space-y-2"}>
        <button
          type="button"
          disabled={busy}
          onClick={() => connectAndLogin().catch(() => {})}
          className={`font-display h-10 w-full rounded-lg px-3 text-[13px] tracking-wide transition disabled:opacity-60 ${
            accent === "gold" ? `border ${btn}` : btn
          }`}
        >
          {busy ? phaseLabel || "…" : "SIGN IN WITH BENTO"}
        </button>
        {busy && phaseLabel && (
          <p className="text-[11.5px] text-ink-faint">{phaseLabel}</p>
        )}
        {error && <p className="text-[12px] text-red-300">{error}</p>}
        {!compact && (
          <p className="text-[11.5px] leading-snug text-ink-faint">
            Opens Bento weblink (
            <span className="font-mono text-ink-soft">/auth/start</span>
            → testnet connect). No MetaMask. After login we mint Free-to-Play
            credits on your managed account via the testnet faucet.
          </p>
        )}
      </div>
    );
  }

  const trading = managedAddress || signingAddress!;

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-line bg-bg/50 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-[10px] tracking-[.18em] text-brand">
            BENTO SESSION
          </span>
          <button
            type="button"
            onClick={logout}
            className="text-[11px] text-ink-faint underline-offset-2 hover:text-ink-soft hover:underline"
          >
            sign out
          </button>
        </div>
        {username && (
          <div className="mt-1 font-mono text-[12px] text-ink-soft">@{username}</div>
        )}
        <dl className="mt-2 space-y-1 text-[11.5px]">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-faint">Bento wallet</dt>
            <dd className="font-mono text-ink" title={trading}>
              {shortAddr(trading)}
            </dd>
          </div>
        </dl>
        {!compact && (
          <p className="mt-2 text-[11px] leading-snug text-ink-faint">
            Bets spend Free-to-Play <span className="text-ink-soft">credits</span>{" "}
            (builder faucet on login). Sign in again anytime via Bento weblink.
          </p>
        )}
      </div>
      {error && <p className="text-[12px] text-red-300">{error}</p>}
    </div>
  );
}
