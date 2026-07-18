"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Card } from "@/lib/scoring/types";
import { useBentoWallet } from "@/hooks/useBentoWallet";
import WalletSession from "@/components/WalletSession";

/** Create a versus Bento market from a VS fixture — requires Bento weblink JWT. */
export default function VersusMarketPanel({
  challenger,
  opponent,
}: {
  challenger: Card;
  opponent: Card;
}) {
  const router = useRouter();
  const wallet = useBentoWallet();
  const { isLoggedIn, ensureToken, setError, busy } = wallet;
  const [status, setStatus] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const create = async () => {
    setStatus(null);
    setError(null);
    setCreating(true);
    try {
      const token = await ensureToken();
      const res = await fetch("/api/bento/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          optionA: challenger.name,
          optionB: opponent.name,
          question: `${challenger.name} vs ${opponent.name}`,
          category: challenger.market?.category || opponent.market?.category || "Sports",
          description: `Versus market from ${challenger.login} vs ${opponent.login}`,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        result?: { raw?: { duelId?: string }; duelId?: string };
      };
      if (!res.ok) throw new Error(data.error || "Create failed");

      const duelId =
        data.result?.raw?.duelId ||
        (data.result as { duelId?: string } | undefined)?.duelId;
      if (duelId) {
        setStatus(`Market created: ${duelId}`);
        router.push(`/${encodeURIComponent(duelId)}`);
      } else {
        setStatus("Market accepted — check the Bento catalog shortly.");
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto mt-4 w-full max-w-[480px] rounded-xl border border-gold/35 bg-white/[0.03] p-4">
      <div className="font-display text-[11px] font-bold tracking-[.22em] text-gold-hi">
        OPEN A VERSUS MARKET
      </div>
      <p className="mt-1.5 text-[13px] leading-snug text-ink-soft">
        Sign in with your wallet, then create a live Bento versus market —{" "}
        <span className="text-ink">{challenger.name}</span> vs{" "}
        <span className="text-ink">{opponent.name}</span>.
      </p>

      <div className="mt-3">
        <WalletSession wallet={wallet} accent="gold" compact={isLoggedIn} />
      </div>

      {isLoggedIn && (
        <button
          type="button"
          disabled={creating || busy}
          onClick={() => create()}
          className="font-display mt-3 h-10 w-full rounded-lg bg-brand px-4 text-[13px] tracking-wide text-[#04130a] hover:bg-brand-hi disabled:opacity-60"
        >
          {creating ? "CREATING…" : "CREATE VERSUS MARKET"}
        </button>
      )}

      {status && <p className="mt-2 text-[12px] text-ink-soft">{status}</p>}
    </div>
  );
}
