"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { Card } from "@/lib/scoring/types";
import PlayerCard from "./PlayerCard";
import GeminiCard, { hasGeminiCardArt } from "./GeminiCard";
import TiltCard from "./TiltCard";
import StoryFrame from "./StoryFrame";
import CardActions from "./CardActions";
import DuelButton from "./DuelButton";
import FlagPicker from "./FlagPicker";
import Mascot from "./Mascot";
import dynamic from "next/dynamic";
import { AttributesPanel, MetricsPanel, ReportHeader } from "./ScoutReport";
import DistributionPanel from "./DistributionPanel";
import StatsLegend from "./StatsLegend";
import BetPanel from "./BetPanel";
import WalletChip from "./WalletChip";
import BetsSidebar, { BETS_CHANGED_EVENT } from "./BetsSidebar";
import { confettiPalette, resolveCardTheme, resolveResultTheme } from "./finishTheme";
import { useReveal } from "@/hooks/useReveal";
import { burstConfetti } from "@/lib/confetti";
import {
  isLiveRefreshableDuelId,
  mergeLiveScoutCard,
} from "@/lib/bento/merge-live-card";
import { useBentoWallet } from "@/hooks/useBentoWallet";
import { recomputeCardRealtime } from "@/lib/local/realtime-signals";

const HowItWorksModal = dynamic(() => import("./HowItWorksModal"), { ssr: false });

interface Props {
  card: Card;
  onBack: () => void;
  /** Edit the card's flag from the report (click-the-flag picker). */
  onCountryChange: (code: string) => void;
  /** Default flag; share links only carry ?country= when it's overridden. */
  canonicalCountry?: string;
}

// Card width scales with the viewport but is bounded by BOTH width and height
// (and a hard min/max) so it never overflows a narrow phone or a short laptop.
const CARD_WIDTH = "clamp(220px, min(80vw, 40vh), 332px)";

export default function ResultView({
  card: initialCard,
  onBack,
  onCountryChange,
  canonicalCountry = "",
}: Props) {
  const captureRef = useRef<HTMLDivElement>(null);
  const storyRef = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState(initialCard);
  const wallet = useBentoWallet();
  const theme = resolveResultTheme(card);
  const phase = useReveal(card.finish);
  const [modalOpen, setModalOpen] = useState(false);
  const [betsOpen, setBetsOpen] = useState(false);

  useEffect(() => {
    setCard(initialCard);
  }, [initialCard]);

  const refreshLiveMetrics = useCallback(async () => {
    const duelId = card.market?.duelId;
    if (!isLiveRefreshableDuelId(duelId)) return;
    try {
      const addr = wallet.managedAddress || wallet.signingAddress;
      const qs = new URLSearchParams({ duelId: duelId! });
      if (addr) qs.set("address", addr);
      const res = await fetch(`/api/bento/live-metrics?${qs}`);
      const data = (await res.json()) as { card?: Card; error?: string };
      if (!res.ok || !data.card?.report) return;
      setCard((prev) => mergeLiveScoutCard(prev, data.card!));
    } catch {
      /* best-effort */
    }
  }, [card.market?.duelId, wallet.managedAddress, wallet.signingAddress]);

  // Refresh attributes + scouting metrics from the live book after each bet
  useEffect(() => {
    if (!isLiveRefreshableDuelId(card.market?.duelId)) return;
    void refreshLiveMetrics();
    const onBets = () => {
      window.setTimeout(() => void refreshLiveMetrics(), 1_200);
      window.setTimeout(() => void refreshLiveMetrics(), 4_000);
    };
    window.addEventListener(BETS_CHANGED_EVENT, onBets);
    const poll = window.setInterval(() => void refreshLiveMetrics(), 25_000);
    return () => {
      window.removeEventListener(BETS_CHANGED_EVENT, onBets);
      window.clearInterval(poll);
    };
  }, [card.market?.duelId, refreshLiveMetrics]);

  // Tick clocks for hyper-local cards (days left / days live) while viewing.
  // Skip when a live Bento duel is polled above — that path owns volume + endsIn.
  useEffect(() => {
    if (isLiveRefreshableDuelId(card.market?.duelId)) return;
    const minted = card.market?.scoutMintedAt;
    if (!card.login.startsWith("local-") && !minted) return;
    const tick = () => {
      setCard((prev) => {
        if (isLiveRefreshableDuelId(prev.market?.duelId)) return prev;
        const createdAtMs = prev.market?.scoutMintedAt || minted || Date.now();
        return recomputeCardRealtime(prev, {
          createdAtMs,
          deadlineAtMs: prev.market?.scoutDeadlineAt,
          draftCategory: prev.market?.category || null,
        });
      });
    };
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [card.login, card.market?.scoutMintedAt, card.market?.duelId]);

  // BACK when the visitor came from home this tab; otherwise (direct / shared
  // link) a CTA to make their own card. Default to the CTA so share-link
  // visitors — the growth case — see it without a flash.
  const [seenHome, setSeenHome] = useState(false);
  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem("bento:seen-home") === "1";
    } catch {}
    // Deferred (not a synchronous set-in-effect) so it can't cascade a render.
    const t = setTimeout(() => setSeenHome(seen), 0);
    return () => clearTimeout(t);
  }, []);

  // Fire confetti when the rare-tier reveal hits its burst, in the card's own
  // tier palette — see finishTheme.
  useEffect(() => {
    if (phase === "burst") burstConfetti(confettiPalette(card));
  }, [phase, card]);

  const ignited = phase === "ignite" || phase === "burst" || phase === "freeze";

  return (
    <>
    <main className="relative z-[2] mx-auto flex min-h-[100dvh] w-full max-w-[1280px] flex-col px-[clamp(16px,4vw,22px)]">
      {/* Tier-reactive backdrop: dims the global green wash and lets the card's
          own tier color own the result screen (green is the action, the card is
          the prize — they shouldn't fight here). Fades in with the reveal. The
          bottom fade-out keeps the tier wash from burying the floor. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background: `radial-gradient(120% 80% at 50% -10%, ${theme.glow}, transparent 55%), #02001e`,
          opacity: ignited ? 0.9 : 0.4,
          transition: "opacity 1s ease",
          WebkitMaskImage: "linear-gradient(to bottom, #000 68%, rgba(0,0,0,.25) 100%)",
          maskImage: "linear-gradient(to bottom, #000 68%, rgba(0,0,0,.25) 100%)",
        }}
      />

      {/* top bar: BACK button + mascot on the left, "how it works" on the right */}
      <div className="mb-[8px] mt-[clamp(8px,2vh,18px)] flex w-full shrink-0 items-center justify-between gap-[10px]">
        <div className="flex items-center gap-[10px]">
          <button
            onClick={onBack}
            className={
              seenHome
                ? "group inline-flex items-center gap-[6px] text-[13px] font-medium tracking-wide text-ink-faint transition hover:text-ink"
                : "group inline-flex items-center gap-[6px] text-[13px] font-semibold tracking-wide text-brand transition hover:text-brand-hi"
            }
          >
            {seenHome ? (
              <>
                <ArrowLeft size={16} className="transition-transform group-hover:-translate-x-0.5" />
                BACK
              </>
            ) : (
              <>
                <ArrowLeft size={16} className="transition-transform group-hover:translate-x-0.5" />
                GET A CARD
              </>
            )}
          </button>
          <Mascot size={40} kick={false} ball={false} animate={false} />
        </div>
        <div className="flex items-center gap-[clamp(10px,2vw,16px)] justify-end">
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="cursor-pointer text-[12.5px] font-semibold text-ink-soft underline-offset-2 transition hover:text-brand hover:underline max-[420px]:hidden"
          >
            how it works ↗
          </button>
          <button
            type="button"
            onClick={() => setBetsOpen(true)}
            className="font-display rounded-lg border border-line bg-white/[0.04] px-2.5 py-1.5 text-[11px] tracking-[.12em] text-ink-soft transition hover:border-brand/40 hover:text-ink"
          >
            MY BETS
          </button>
          <WalletChip />
        </div>
      </div>

      <div className="shrink-0">
        <ReportHeader card={card} />
      </div>

      <div className="mt-[clamp(14px,2.4vh,26px)] grid grid-cols-[1fr_auto_1fr] items-start gap-[clamp(16px,2.4vw,40px)] max-[980px]:mt-6 max-[980px]:flex max-[980px]:flex-col max-[980px]:items-center">
        {/* left — attributes + playstyles */}
        <div className="flex justify-end max-[980px]:order-2 max-[980px]:w-full max-[980px]:max-w-[420px] max-[980px]:justify-center">
          <div className="w-full max-w-[360px]">
            <AttributesPanel card={card} />
          </div>
        </div>

        {/* center — the card + actions (the walkout happens here) */}
        <div className="relative flex flex-col items-center gap-[clamp(12px,2vh,18px)] max-[980px]:order-1 mb-14">
          {/* spotlight wash — a soft, diffuse glow from above as the card rises.
              Reduced + blurred so it reads as ambient light, not a hard beam. */}
          <div
            className="animate-spotlight pointer-events-none absolute left-1/2 top-[-10%] z-0 h-[70%] w-[120%] blur-[40px]"
            style={{
              background: `radial-gradient(60% 70% at 50% 0%, ${theme.glow}, transparent 72%)`,
              opacity: ignited ? 0.4 : 0,
              transition: "opacity .5s ease",
            }}
          />
          {/* card stage — holds the captured card AND the flag editor as siblings.
              The editor overlays the flag slot but lives OUTSIDE captureRef, so the
              downloaded/copied PNG never includes the picker UI. */}
          <div className="animate-walkout relative" style={{ width: CARD_WIDTH }}>
            {/* The tilt wraps captureRef rather than sitting inside it, so the hover
                glass is a sibling of the captured tree and never lands in the PNG.
                maskSrc clips the shine to the card's own silhouette. */}
            <TiltCard maskSrc={hasGeminiCardArt(card) ? undefined : resolveCardTheme(card).bg}>
              <div ref={captureRef} className="relative">
                <div
                  className="animate-glow pointer-events-none absolute -inset-[12%] z-0 rounded-full"
                  style={{
                    background: `radial-gradient(closest-side, ${theme.glow}, transparent 72%)`,
                    opacity: ignited ? 1 : 0,
                    transition: "opacity .6s ease",
                  }}
                />
                <div className="relative z-[1]">
                  {hasGeminiCardArt(card) ? (
                    <GeminiCard card={card} />
                  ) : (
                    <PlayerCard card={card} />
                  )}
                </div>
              </div>
            </TiltCard>
            {!hasGeminiCardArt(card) && (
              <FlagPicker value={card.country} onChange={onCountryChange} />
            )}
          </div>
          <div className="flex flex-col gap-[10px]" style={{ width: CARD_WIDTH }}>
            <CardActions
              card={card}
              targetRef={captureRef}
              storyRef={storyRef}
              canonicalCountry={canonicalCountry}
            />
            <DuelButton login={card.login} />
          </div>
          <div className="w-[min(100%,440px)]">
            <BetPanel card={card} onCardChange={setCard} />
          </div>
        </div>

        {/* right — scouting metrics + distribution */}
        <div className="flex max-[980px]:order-3 max-[980px]:w-full max-[980px]:max-w-[420px] max-[980px]:justify-center">
          <div className="flex w-full max-w-[360px] flex-col gap-[14px]">
            <MetricsPanel card={card} />
            <DistributionPanel card={card} />
          </div>
        </div>
      </div>

      <StatsLegend card={card} />

      {/* Off-screen story canvas (1080×1920). Parked in a 0×0 clip holder at the
          viewport origin — NOT display:none — so its card art/avatar/fonts paint
          and decode, letting renderCardImage clone + capture it for the Story
          download/share. Same off-screen technique as lib/capture.ts. */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          overflow: "hidden",
          zIndex: -1,
          pointerEvents: "none",
        }}
      >
        <StoryFrame ref={storyRef} card={card} />
      </div>
    </main>

    {modalOpen && <HowItWorksModal onClose={() => setModalOpen(false)} />}
    <BetsSidebar open={betsOpen} onClose={() => setBetsOpen(false)} />
    </>
  );
}
