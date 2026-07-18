"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const TOKEN_KEY = "bento:jwt";
const SIGNING_KEY = "bento:signing";
const MANAGED_KEY = "bento:managed";
const USER_KEY = "bento:username";

export type WalletPhase = "idle" | "redirecting" | "ready";

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/**
 * Bento weblink login (no MetaMask):
 * navigate to /auth/start → getLinkUrl → testnet.bento.fun/connect
 * → /auth/callback?code= → exchange + faucet
 *
 * @see https://docs.bento.fun/concepts/authentication
 * @see https://docs.bento.fun/concepts/money#testnet-faucet-register-does-not-fund-you
 */
export function useBentoWallet() {
  const [signingAddress, setSigningAddress] = useState<string | null>(null);
  const [managedAddress, setManagedAddress] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<WalletPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  const clearSession = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(SIGNING_KEY);
      localStorage.removeItem(MANAGED_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem("bento:address");
      localStorage.removeItem("bento:weblink-state");
    } catch {}
    setToken(null);
    setSigningAddress(null);
    setManagedAddress(null);
    setUsername(null);
    setPhase("idle");
    setError(null);
  }, []);

  useEffect(() => {
    try {
      const t = localStorage.getItem(TOKEN_KEY);
      setToken(t);
      setSigningAddress(localStorage.getItem(SIGNING_KEY));
      setManagedAddress(localStorage.getItem(MANAGED_KEY));
      setUsername(localStorage.getItem(USER_KEY));
      if (t) setPhase("ready");
    } catch {}

    // Surface errors from /auth/start redirect; strip stale ?bento_login=1
    try {
      const u = new URL(window.location.href);
      const authErr = u.searchParams.get("auth_error");
      if (authErr) {
        setError(decodeURIComponent(authErr));
        u.searchParams.delete("auth_error");
      }
      if (u.searchParams.has("bento_login")) {
        u.searchParams.delete("bento_login");
      }
      if (authErr || u.search !== window.location.search) {
        window.history.replaceState({}, "", `${u.pathname}${u.search}${u.hash}`);
      }
    } catch {}
  }, []);

  const connectAndLogin = useCallback(async () => {
    setError(null);
    setPhase("redirecting");
    // Always enter via 127.0.0.1 locally — Bento rejects returnUrl host `localhost`
    const start = new URL("/auth/start", window.location.href);
    if (start.hostname === "localhost") start.hostname = "127.0.0.1";
    window.location.assign(start.toString());
    return null;
  }, []);

  const ensureToken = useCallback(async () => {
    if (token) return token;
    await connectAndLogin();
    throw new Error("Redirecting to Bento login…");
  }, [token, connectAndLogin]);

  const busy = phase === "redirecting";

  const phaseLabel = useMemo(() => {
    switch (phase) {
      case "redirecting":
        return "Opening Bento…";
      case "ready":
        return "Signed in";
      default:
        return null;
    }
  }, [phase]);

  return {
    address: signingAddress,
    signingAddress,
    managedAddress,
    username,
    token,
    phase,
    phaseLabel,
    busy,
    error,
    hasInjectedWallet: true,
    shortAddr,
    connectAndLogin,
    ensureToken,
    logout: clearSession,
    setError,
    isLoggedIn: Boolean(token && signingAddress),
  };
}
