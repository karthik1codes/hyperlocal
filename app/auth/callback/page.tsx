"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Background from "@/components/Background";

const TOKEN_KEY = "bento:jwt";
const SIGNING_KEY = "bento:signing";
const MANAGED_KEY = "bento:managed";
const USER_KEY = "bento:username";

/**
 * After Bento connect: `/auth/callback?code=…&state=…`
 * → `sdk.public.externalLink.exchange({ code })` + testnet faucet.
 *
 * @see https://docs.bento.fun/concepts/authentication
 * @see https://docs.bento.fun/concepts/money#testnet-faucet-register-does-not-fund-you
 */
function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = params.get("code");
    const state = params.get("state");
    const err = params.get("error");
    if (err) {
      setError(err);
      return;
    }
    if (!code) {
      setError("Missing login code from Bento (expected ?code=…&state=…).");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/bento/auth/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, state: state || undefined }),
        });
        const data = (await res.json()) as {
          error?: string;
          token?: string;
          signingAddress?: string;
          managedAddress?: string | null;
          username?: string | null;
          faucetMinted?: boolean;
        };
        if (!res.ok || !data.token || !data.signingAddress) {
          throw new Error(data.error || "Login exchange failed");
        }
        if (cancelled) return;

        localStorage.setItem(TOKEN_KEY, data.token);
        localStorage.setItem(SIGNING_KEY, data.signingAddress);
        localStorage.setItem(
          MANAGED_KEY,
          data.managedAddress || data.signingAddress,
        );
        if (data.username) localStorage.setItem(USER_KEY, data.username);
        router.replace(data.faucetMinted === false ? "/?auth_error=faucet_failed" : "/");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Login failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params, router]);

  return (
    <main className="relative z-[2] flex min-h-screen flex-col items-center justify-center px-6 text-center">
      {error ? (
        <>
          <p className="font-display text-[28px] text-gold-hi">LOGIN FAILED</p>
          <p className="mt-3 max-w-md text-[14px] text-ink-soft">{error}</p>
          <button
            type="button"
            onClick={() => router.replace("/")}
            className="font-display mt-6 rounded-lg bg-brand px-4 py-2 text-[13px] text-[#04130a]"
          >
            BACK HOME
          </button>
        </>
      ) : (
        <>
          <p className="font-display text-[28px] text-brand">SIGNING YOU IN…</p>
          <p className="mt-3 max-w-md text-[14px] text-ink-soft">
            Exchanging weblink <span className="font-mono">code</span> for a JWT,
            then minting Free-to-Play credits via the testnet faucet.
          </p>
        </>
      )}
    </main>
  );
}

export default function AuthCallbackPage() {
  return (
    <div className="relative min-h-screen text-ink">
      <Background />
      <Suspense
        fallback={
          <main className="relative z-[2] flex min-h-screen items-center justify-center">
            <p className="font-display text-[20px] text-ink-soft">Loading…</p>
          </main>
        }
      >
        <CallbackInner />
      </Suspense>
    </div>
  );
}
