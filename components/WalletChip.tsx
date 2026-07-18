"use client";

import { useBentoWallet } from "@/hooks/useBentoWallet";

type Wallet = ReturnType<typeof useBentoWallet>;

/** Compact header — Bento weblink login / session. */
export default function WalletChip({
  wallet: walletProp,
  menuOpen,
  onMenuToggle,
}: {
  wallet?: Wallet;
  menuOpen?: boolean;
  onMenuToggle?: () => void;
} = {}) {
  const walletHook = useBentoWallet();
  const wallet = walletProp ?? walletHook;
  const {
    isLoggedIn,
    signingAddress,
    username,
    busy,
    phaseLabel,
    shortAddr,
    connectAndLogin,
    logout,
  } = wallet;

  const toggleMode = typeof onMenuToggle === "function";
  const label =
    username && username.length
      ? `@${username}`
      : signingAddress
        ? shortAddr(signingAddress)
        : "Bento";

  if (isLoggedIn && signingAddress) {
    return (
      <button
        type="button"
        onClick={toggleMode ? onMenuToggle : logout}
        aria-expanded={toggleMode ? menuOpen : undefined}
        title={toggleMode ? "Bento session" : "Sign out of Bento"}
        className="font-mono inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-white/[0.04] px-3 text-[12px] text-ink-soft transition hover:border-brand/40 hover:text-ink"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={
        toggleMode
          ? onMenuToggle
          : () => connectAndLogin().catch(() => {})
      }
      aria-expanded={toggleMode ? menuOpen : undefined}
      title="Sign in with Bento (weblink — no MetaMask)"
      className="font-display inline-flex h-9 items-center rounded-lg bg-brand px-3 text-[12px] tracking-wide text-[#04130a] transition hover:bg-brand-hi disabled:cursor-not-allowed disabled:opacity-55"
    >
      {busy ? phaseLabel || "…" : "SIGN IN"}
    </button>
  );
}
