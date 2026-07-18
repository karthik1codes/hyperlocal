"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ScoutForm from "@/components/ScoutForm";
import CardFan from "@/components/CardFan";
import LoadingScreen from "@/components/LoadingScreen";
import WalletChip from "@/components/WalletChip";
import WalletSession from "@/components/WalletSession";
import BetsSidebar from "@/components/BetsSidebar";
import { useBentoWallet } from "@/hooks/useBentoWallet";
import dynamic from "next/dynamic";
import type { Card } from "@/lib/scoring/types";

const HowItWorksModal = dynamic(() => import("@/components/HowItWorksModal"), {
  ssr: false,
});

export default function AppShell({
  scoutCount,
  cards,
}: {
  scoutCount: number | null;
  cards: Card[];
}) {
  const router = useRouter();
  const wallet = useBentoWallet();
  const [isPending, startTransition] = useTransition();
  const [pending, setPending] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [betsOpen, setBetsOpen] = useState(false);
  const walletMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem("bento:seen-home", "1");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!walletMenuOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!walletMenuRef.current?.contains(e.target as Node)) {
        setWalletMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWalletMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [walletMenuOpen]);

  const handleScout = (name: string) => {
    const login = name.trim().replace(/^@/, "");
    if (!login) return;
    setPending(login);
    startTransition(() => router.push(`/${encodeURIComponent(login)}`));
  };

  if (isPending && pending) return <LoadingScreen login={pending} />;

  const pack = cards.slice(0, 6);

  return (
    <>
      <main className="relative z-[2] flex min-h-screen flex-col overflow-x-hidden">
        <div className="absolute right-[clamp(16px,4vw,40px)] top-[clamp(14px,2.5vh,24px)] z-[3] flex items-start gap-3">
          <Link
            href="/"
            className="font-display rounded-lg border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] tracking-[.12em] text-ink-soft transition hover:border-brand/40 hover:text-ink"
          >
            HOME
          </Link>
          <button
            type="button"
            onClick={() => setBetsOpen(true)}
            className="font-display rounded-lg border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] tracking-[.12em] text-ink-soft transition hover:border-brand/40 hover:text-ink"
          >
            MY BETS
          </button>
          <div ref={walletMenuRef} className="relative flex flex-col items-end">
            <WalletChip
              wallet={wallet}
              menuOpen={walletMenuOpen}
              onMenuToggle={() => setWalletMenuOpen((o) => !o)}
            />
            {walletMenuOpen && (
              <div className="absolute right-0 top-[calc(100%+8px)] z-[4] w-[min(280px,calc(100vw-48px))] rounded-[14px] border border-brand/25 bg-bg-deep/95 p-3 shadow-[0_16px_48px_rgba(0,0,0,.55)] backdrop-blur-md">
                <div className="font-display mb-2 text-[11px] font-bold tracking-[.2em] text-brand">
                  {wallet.isLoggedIn ? "BENTO SESSION" : "BENTO LOGIN"}
                </div>
                <WalletSession wallet={wallet} />
                {wallet.isLoggedIn && (
                  <button
                    type="button"
                    onClick={() => {
                      setWalletMenuOpen(false);
                      setBetsOpen(true);
                    }}
                    className="mt-2 w-full rounded-lg border border-brand/30 bg-brand/10 px-3 py-2 text-[12px] font-semibold text-brand-hi transition hover:bg-brand/15"
                  >
                    View my bets →
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Hero + pack side by side on wide screens; pack always visible */}
        <div className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col justify-center gap-6 px-[clamp(18px,4vw,48px)] pb-8 pt-[clamp(56px,7vh,72px)] lg:flex-row lg:items-center lg:gap-6 lg:pb-10">
          <div className="min-w-0 shrink-0 lg:max-w-[440px] lg:flex-[0.85]">
            <ScoutForm
              scoutCount={scoutCount}
              onOpenModal={() => setModalOpen(true)}
              compact
            />
          </div>

          <div className="min-w-0 flex-1 lg:pl-2">
            {pack.length > 0 ? (
              <CardFan cards={pack} onPick={handleScout} label="LIVE MARKETS" />
            ) : (
              <p className="max-w-[360px] text-[14px] leading-snug text-ink-soft">
                No live markets right now. Check{" "}
                <span className="font-mono">BENTO_URL</span> / builder key, or mint on{" "}
                <Link href="/" className="text-brand underline-offset-2 hover:underline">
                  Home
                </Link>
                .
              </p>
            )}
          </div>
        </div>
      </main>

      {modalOpen && <HowItWorksModal onClose={() => setModalOpen(false)} />}
      <BetsSidebar open={betsOpen} onClose={() => setBetsOpen(false)} />
    </>
  );
}
