"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Mascot from "@/components/Mascot";
import LocalLabForm from "@/components/LocalLabForm";
import SideCardFan from "@/components/SideCardFan";
import LoadingScreen from "@/components/LoadingScreen";
import WalletChip from "@/components/WalletChip";
import WalletSession from "@/components/WalletSession";
import BetsSidebar from "@/components/BetsSidebar";
import { useBentoWallet } from "@/hooks/useBentoWallet";
import type { Card } from "@/lib/scoring/types";

export default function HyperLocalShell({
  scoutCount,
  initialCards = [],
}: {
  scoutCount: number | null;
  initialCards?: Card[];
}) {
  const router = useRouter();
  const wallet = useBentoWallet();
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [betsOpen, setBetsOpen] = useState(false);
  const [cards, setCards] = useState<Card[]>(initialCards);
  const [isPending, startTransition] = useTransition();
  const [pending, setPending] = useState<string | null>(null);
  const walletMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCards((prev) => {
      const nextIds = initialCards.map((c) => c.login).join(",");
      const prevIds = prev.map((c) => c.login).join(",");
      if (nextIds === prevIds && prev.length > 0) return prev;
      const serverIds = new Set(initialCards.map((c) => c.login));
      const extras = prev.filter((c) => !serverIds.has(c.login) && !c.login.startsWith("demo-"));
      return [...extras, ...initialCards].slice(0, 12);
    });
  }, [initialCards]);

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

  const handleScout = useCallback(
    (name: string) => {
      const login = name.trim().replace(/^@/, "");
      if (!login) return;
      setPending(login);
      startTransition(() => router.push(`/${encodeURIComponent(login)}`));
    },
    [router],
  );

  const onCardMinted = useCallback((card: Card) => {
    setCards((prev) => {
      const next = [card, ...prev.filter((c) => c.login !== card.login)];
      return next.slice(0, 12);
    });
  }, []);

  if (isPending && pending) return <LoadingScreen login={pending} />;

  return (
    <>
      <main className="relative z-[2] mx-auto flex min-h-screen w-full max-w-[1280px] flex-col px-[clamp(18px,4vw,40px)] pb-16 pt-[clamp(18px,3vh,28px)]">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 -ml-1">
              <Mascot size={96} />
            </div>
            <div className="mb-2 inline-flex items-center gap-[9px] rounded-[8px] border border-white/[0.08] bg-white/[0.025] px-[12px] py-[6px]">
              <span className="font-display text-[14px] leading-none tracking-[.06em] text-ink">
                BENTO<span className="text-gold-hi">.FUN</span>
              </span>
              <span className="font-display mt-[1px] text-[14px] leading-none text-brand">
                {"\u00d7"}
              </span>
              <span className="font-display text-[14px] leading-none tracking-[.06em] text-ink">
                HYPER<span className="text-gold-hi">-LOCAL</span>
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-start justify-end gap-2 sm:gap-3">
            <Link
              href="/markets"
              className="font-display rounded-lg border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] tracking-[.12em] text-ink-soft transition hover:border-brand/40 hover:text-ink"
            >
              MARKETS
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
        </div>

        <div className="flex flex-1 items-start gap-[clamp(20px,4vw,48px)] max-[980px]:flex-col">
          {/* Left — copy + form */}
          <div className="min-w-0 flex-1 max-w-[640px] max-[980px]:max-w-none">
            <h1 className="font-display m-0 mb-3 text-[clamp(40px,6.5vw,80px)] leading-[.86] tracking-[.005em]">
              RATE HYPER-LOCAL
              <br className="max-[520px]:hidden" /> PROBLEMS
              <span className="text-brand">.</span>
            </h1>
            <p className="mb-2 max-w-[520px] text-[clamp(14px,1.6vw,17px)] font-medium leading-[1.5] text-ink-dim">
              Capture asymmetric city knowledge global books miss — then watch a live
              fetch stream mint FUT-style cards you can share.
            </p>
            <p className="mb-5 max-w-[520px] text-[14px] leading-relaxed text-ink-soft">
              Tell us your city / region and a hyper-local problem. We open local Chrome
              tabs, pull the story, then Gemini drafts the prediction and paints the card.
            </p>

            {scoutCount != null && (
              <div className="mb-6 inline-flex items-baseline gap-[9px]">
                <span className="relative flex h-[7px] w-[7px] translate-y-[-1px] self-center" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
                  <span className="relative inline-flex h-[7px] w-[7px] rounded-full bg-brand" />
                </span>
                <span className="font-display text-[20px] leading-none tabular-nums text-ink">
                  {scoutCount.toLocaleString("en-US")}
                </span>
                <span className="text-[12px] text-ink-mute">cards rated</span>
              </div>
            )}

            <LocalLabForm compact onCardMinted={onCardMinted} />
          </div>

          {/* Right — fanned pack */}
          <aside className="relative flex min-w-0 flex-[0.95] flex-col items-center justify-center pt-2 max-[980px]:w-full max-[980px]:pt-8">
            <div className="font-display mb-2 text-[11px] tracking-[.2em] text-brand">
              {cards.some((c) => c.login.startsWith("local-"))
                ? "YOUR LOCAL PACK"
                : "SCOUT PACK"}
            </div>
            <SideCardFan cards={cards} onPick={handleScout} />
            <p className="mt-3 max-w-[280px] text-center text-[11px] leading-snug text-ink-faint">
              Click a card to open it. New mints slide into the pack.
            </p>
          </aside>
        </div>
      </main>

      <BetsSidebar open={betsOpen} onClose={() => setBetsOpen(false)} />
    </>
  );
}
