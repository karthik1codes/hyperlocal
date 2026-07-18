"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Card } from "@/lib/scoring/types";
import { isMarketTradeable } from "@/lib/bento/tradeable";
import { useBentoWallet } from "@/hooks/useBentoWallet";
import WalletSession from "@/components/WalletSession";
import { BETS_CHANGED_EVENT } from "@/components/BetsSidebar";
import { listLocalMadeCards, markLocalCardWarming } from "@/lib/local/made-cards";
import { applyStakeToCard } from "@/lib/bento/merge-live-card";
import { preferMarketDisplayCategory } from "@/lib/bento/category";
import {
  dispatchMarketLive,
  ensureNotifyPermission,
} from "@/lib/notify-live";

/** Platform floor from https://docs.bento.fun/guides/place-bet */
const MIN_BET = 5;
const DEFAULT_BET = 10;
const STAKE_CHIPS = [5, 10, 25, 50, 100] as const;

type Quote = {
  sharesOut: number;
  avgPrice: number;
  yesPrice: number;
  noPrice: number;
  odds: number;
  payoutIfWin: number;
  priceImpact: number;
};

export default function BetPanel({
  card: initialCard,
  onCardChange,
}: {
  card: Card;
  /** Keep scout report metrics/attributes in sync with create & bet. */
  onCardChange?: (card: Card) => void;
}) {
  const [card, setCard] = useState(initialCard);
  const market = card.market;
  const wallet = useBentoWallet();
  const { isLoggedIn, ensureToken, setError, busy, managedAddress, signingAddress, token } =
    wallet;
  const [optionIndex, setOptionIndex] = useState(0);
  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [status, setStatus] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [creditsHint, setCreditsHint] = useState<string | null>(null);

  const [opensAt, setOpensAt] = useState<number | null>(null);
  const [waitLabel, setWaitLabel] = useState<string | null>(null);
  const [liveBanner, setLiveBanner] = useState<string | null>(null);

  const isPolymarket = market?.source === "polymarket";
  const isLocal =
    market?.source === "local" || Boolean(market?.duelId?.startsWith("local-"));
  const isDemo = Boolean(market?.duelId?.startsWith("demo-"));
  const canPlaceOnChain = Boolean(market && !isPolymarket && !isLocal && !isDemo);
  /** Bento private markets open ~5–6 min after create (on-chain startTime floor). */
  const marketWarming = Boolean(opensAt && opensAt > Date.now());
  /** Hold the tab when open is close (matches server placeBet wait ≤ ~2 min). */
  const SHORT_WAIT_MS = 120_000;

  const marketWarning = useMemo(() => {
    if (!market || !canPlaceOnChain) return null;
    const check = isMarketTradeable({
      status: market.status,
      endsIn: market.endsIn,
      duelType: market.duelType,
    });
    if (!check.ok) return check.reason;
    const ends = Number(market.endsIn ?? 0);
    if (ends < 3600) {
      return `Only ~${Math.round(ends / 60)} min left — prefer a market with more runway.`;
    }
    return null;
  }, [market, canPlaceOnChain]);

  const marketBlocked = useMemo(() => {
    if (!market || !canPlaceOnChain) return false;
    return !isMarketTradeable({
      status: market.status,
      endsIn: market.endsIn,
      duelType: market.duelType,
    }).ok;
  }, [market, canPlaceOnChain]);

  const isDeadLivePrediction =
    card.login.startsWith("local-") &&
    market != null &&
    !market.duelId.startsWith("local-") &&
    Number(market.status) < 0;

  /** Your hyper-local card — keep stake UI even if Bento cancelled the last duel. */
  const isOwnLocalPrediction = card.login.startsWith("local-");

  const options = useMemo(() => {
    if (!market) return ["Yes — the outcome happens", "No — the outcome fails"];
    if (market.options.length >= 2) {
      const a = market.options[0]!.trim();
      const b = market.options[1]!.trim();
      const bad = (s: string) =>
        /^(yes|no)$/i.test(s) ||
        /resolve yes/i.test(s) ||
        /^yes\s*—\s*[“"]?who\b/i.test(s) ||
        s.length > 85;
      if (bad(a) || bad(b)) {
        return ["Yes — the outcome happens", "No — the outcome fails"];
      }
      return [a, b].map((s) => s.slice(0, 80));
    }
    return ["Yes — the outcome happens", "No — the outcome fails"];
  }, [market]);

  const stakeUnits = useMemo(() => {
    const n = Math.floor(Number(amount));
    return Number.isFinite(n) ? n : 0;
  }, [amount]);

  useEffect(() => {
    setCard(initialCard);
  }, [initialCard]);

  const pushCard = useCallback(
    (next: Card) => {
      setCard(next);
      onCardChange?.(next);
    },
    [onCardChange],
  );

  // Restore go-live countdown after refresh so BET stays locked until open
  useEffect(() => {
    const login = initialCard.login.toLowerCase();
    const duelId = initialCard.market?.duelId?.toLowerCase() || "";
    const row = listLocalMadeCards().find(
      (r) =>
        r.localLogin.toLowerCase() === login ||
        (duelId && r.duelId?.toLowerCase() === duelId),
    );
    if (row?.opensAt && row.opensAt > Date.now() + 2_000) {
      setOpensAt(row.opensAt);
    }
  }, [initialCard.login, initialCard.market?.duelId]);

  useEffect(() => {
    if (!opensAt) {
      setWaitLabel(null);
      return;
    }

    let fired = false;
    const fireLive = () => {
      if (fired) return;
      fired = true;
      const q = market?.question || card.name;
      const duelId = market?.duelId || card.login;
      dispatchMarketLive({
        id: `${duelId}:${opensAt}`,
        title: "Market is live — bet now",
        body: q.slice(0, 120),
        href: `/${encodeURIComponent(card.login)}`,
        question: q,
      });
      setLiveBanner(q);
      setWaitLabel("Market is open — place your bet now.");
      setStatus(`LIVE — betting is open on “${q.slice(0, 72)}${q.length > 72 ? "…" : ""}”.`);
    };

    const left = opensAt - Date.now();
    if (left <= 0) {
      fireLive();
      return;
    }

    void ensureNotifyPermission();

    const tick = () => {
      const ms = opensAt - Date.now();
      if (ms <= 0) {
        fireLive();
        return;
      }
      const m = Math.floor(ms / 60_000);
      const s = Math.ceil((ms % 60_000) / 1000);
      setWaitLabel(
        m > 0
          ? `Opens in ${m}m ${s}s — you’ll get a notification when live`
          : `Opens in ${s}s — notification firing at zero`,
      );
    };
    tick();
    const interval = setInterval(tick, 1000);
    // Exact timeout so the alert is immediate at open (not waiting for next 1s tick)
    const timeout = setTimeout(fireLive, left + 50);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [opensAt, market?.question, market?.duelId, card.login, card.name]);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Brief client hold near open time only (clock skew), not the full ~5 min window. */
  const waitUntilOpenShort = useCallback(async (until: number) => {
    setOpensAt(until);
    while (Date.now() < until) {
      await sleep(Math.min(2_000, Math.max(250, until - Date.now())));
    }
    setOpensAt(null);
    await sleep(2_500);
  }, []);

  const placeBetRequest = useCallback(
    async (args: {
      jwt: string;
      duelId: string;
      duelType: string;
      optionLabel: string;
      units: number;
      collateralMode: string;
    }) => {
      const res = await fetch("/api/bento/bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: args.jwt,
          duelId: args.duelId,
          optionIndex: optionIndex === 0 ? 0 : 1,
          amount: String(args.units),
          duelType: args.duelType,
          optionLabel: args.optionLabel,
          address: managedAddress || signingAddress || undefined,
          collateralMode: args.collateralMode === "usdc" ? "usdc" : "credits",
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        ok?: boolean;
        bet?: string;
        duelType?: string;
        units?: number;
        code?: string;
        opensInMs?: number;
        opensAt?: number;
      };
      return { res, data };
    },
    [optionIndex, managedAddress, signingAddress],
  );

  useEffect(() => {
    if (!isLoggedIn || !token) return;
    const addr = managedAddress || signingAddress;
    if (!addr) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/bento/credits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, address: addr, mint: true }),
        });
        const data = (await res.json()) as {
          balance?: number | null;
          faucet?: { creditsMinterBalance?: number; status?: string };
          mint?: { ok?: boolean; message?: string };
          error?: string;
        };
        if (cancelled) return;
        const bal = data.balance;
        const faucetCredits = data.faucet?.creditsMinterBalance ?? 0;
        if (bal != null) {
          setCreditsHint(
            `Credits ≈ ${bal.toFixed(2)}${
              faucetCredits <= 0 ? " · faucet empty (cannot remint)" : ""
            }`,
          );
        } else if (faucetCredits <= 0) {
          setCreditsHint(
            "Faucet treasury empty (can't remint) — fine if your account already has credits.",
          );
        } else if (data.mint && !data.mint.ok) {
          setCreditsHint(data.mint.message || "Faucet mint failed");
        } else {
          setCreditsHint("Credits balance unknown — faucet looks reachable.");
        }
      } catch {
        if (!cancelled) setCreditsHint(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, token, managedAddress, signingAddress]);

  const refreshQuote = useCallback(async () => {
    if (!canPlaceOnChain || !market || !isLoggedIn) {
      setQuote(null);
      return;
    }
    if (stakeUnits < MIN_BET) {
      setQuote(null);
      return;
    }
    setQuoting(true);
    try {
      const jwt = await ensureToken();
      const res = await fetch("/api/bento/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: jwt,
          duelId: market.duelId,
          optionIndex,
          amount: String(stakeUnits),
          address: managedAddress || signingAddress || undefined,
        }),
      });
      const data = (await res.json()) as { error?: string; quote?: Quote };
      if (!res.ok || !data.quote) {
        setQuote(null);
        return;
      }
      setQuote(data.quote);
    } catch {
      setQuote(null);
    } finally {
      setQuoting(false);
    }
  }, [canPlaceOnChain, market, isLoggedIn, stakeUnits, optionIndex, ensureToken, managedAddress, signingAddress]);

  useEffect(() => {
    if (!canPlaceOnChain || !isLoggedIn) return;
    const t = setTimeout(() => void refreshQuote(), 350);
    return () => clearTimeout(t);
  }, [canPlaceOnChain, isLoggedIn, refreshQuote]);

  const publishLocal = useCallback(async (opts?: { force?: boolean }): Promise<{
    card: Card;
    opensAt: number | null;
  } | null> => {
    setPublishing(true);
    setStatus(null);
    setError(null);
    try {
      const jwt = await ensureToken();
      const res = await fetch("/api/local/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: jwt,
          login: card.login,
          card,
          address: managedAddress || signingAddress || undefined,
          force: Boolean(opts?.force),
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        card?: Card;
        duelId?: string;
        warning?: string;
        opensInMs?: number;
        already?: boolean;
      };
      if (!res.ok || !data.card?.market) {
        throw new Error(data.error || "Could not open live prediction");
      }
      pushCard(data.card);
      const delay = Math.max(0, data.opensInMs ?? (data.already ? 0 : 6 * 60_000 + 30_000));
      const openAt = delay > 2_000 ? Date.now() + delay : data.already ? null : Date.now() + delay;
      if (openAt && openAt > Date.now()) {
        setOpensAt(openAt);
        void ensureNotifyPermission();
      }
      const localLogin = card.login.startsWith("local-")
        ? card.login
        : data.card.login.startsWith("local-")
          ? data.card.login
          : card.login;
      markLocalCardWarming({
        localLogin,
        duelId: data.duelId || data.card.market.duelId,
        question:
          data.card.market.question || data.card.name || card.market?.question || card.name,
        opensAt: openAt ?? Date.now(),
        region: data.card.country || card.country || "",
        overall: data.card.overall,
      });
      const mins = Math.max(1, Math.round(delay / 60_000));
      setStatus(
        data.already && delay <= 2_000
          ? `Prediction already live (${data.duelId?.slice(0, 14) ?? "ok"}…). You can bet now.`
          : data.already
            ? `Prediction is warming up (${data.duelId?.slice(0, 14) ?? "ok"}…). Opens in ~${mins} min — then tap BET.`
            : `Private prediction created (${data.duelId?.slice(0, 14) ?? "ok"}…). Opens in ~${mins} min — allow notifications to get pinged the second it goes live.`,
      );
      return { card: data.card, opensAt: openAt };
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not open prediction");
      return null;
    } finally {
      setPublishing(false);
    }
  }, [card, ensureToken, setError, managedAddress, signingAddress, pushCard]);

  if (!market) return null;

  const place = async () => {
    setStatus(null);
    setError(null);
    setPlacing(true);
    try {
      let live = card;
      let liveMarket = live.market!;
      let openAt: number | null = opensAt;

      // Own hyper-local: open / recreate prediction first (status=-1 → always force)
      const dead = Number(liveMarket.status) < 0;
      const needsPublish =
        isLocal ||
        (isOwnLocalPrediction &&
          (dead ||
            liveMarket.duelId.startsWith("local-") ||
            liveMarket.source === "local"));

      if (needsPublish) {
        // force only when minting over a dead binding; warming -1 is remapped server-side
        const published = await publishLocal({ force: false });
        if (!published?.card.market) throw new Error("Open the live prediction first.");
        live = published.card;
        liveMarket = published.card.market!;
        openAt = published.opensAt;
        // Truly cancelled after reuse attempt → hard recreate once
        if (Number(liveMarket.status) < 0 && !liveMarket.duelId.startsWith("local-")) {
          const fresh = await publishLocal({ force: true });
          if (!fresh?.card.market) throw new Error("Open the live prediction first.");
          live = fresh.card;
          liveMarket = { ...fresh.card.market, status: 1 };
          openAt = fresh.opensAt;
          pushCard({ ...live, market: liveMarket });
        }
      }

      if (
        liveMarket.source === "polymarket" ||
        liveMarket.duelId.startsWith("demo-") ||
        liveMarket.duelId.startsWith("local-") ||
        liveMarket.duelId.startsWith("pm-")
      ) {
        throw new Error(
          isPolymarket
            ? "Props & Futures cards are scout-only. Pick a native Bento market to place with credits."
            : "This card can't accept bets yet.",
        );
      }

      // Private / pre-start catalogs often return status=-1 — soft-open and continue
      if (Number(liveMarket.status) < 0) {
        liveMarket = { ...liveMarket, status: 1 };
        pushCard({ ...live, market: liveMarket });
      }

      const n = Math.floor(Number(amount));
      if (!Number.isFinite(n) || n < MIN_BET) {
        throw new Error(`Minimum bet is ${MIN_BET} credits (Bento platform floor).`);
      }

      const isVersus = String(liveMarket.duelType).toLowerCase() === "versus";
      // UI shows descriptive outcomes; Bento prediction API still wants YES/NO
      const optionLabel = isVersus
        ? optionIndex === 0
          ? options[0] || "optionA"
          : options[1] || "optionB"
        : optionIndex === 0
          ? "YES"
          : "NO";
      const picked = options[optionIndex] || optionLabel;

      // ~5 min Bento floor: don't hold the tab for the whole wait — notify + tap BET when close/live
      if (openAt && openAt > Date.now() + SHORT_WAIT_MS) {
        setOpensAt(openAt);
        void ensureNotifyPermission();
        const mins = Math.max(1, Math.ceil((openAt - Date.now()) / 60_000));
        setStatus(
          `Your prediction is warming up (~${mins} min). You’ll get a notification — then tap BET on “${picked}”.`,
        );
        return;
      }
      if (openAt && openAt > Date.now()) {
        setStatus(`Almost open — placing on “${picked}”…`);
        await waitUntilOpenShort(openAt);
      }

      let jwtFresh = await ensureToken();
      const tryWith = async () =>
        placeBetRequest({
          jwt: jwtFresh,
          duelId: liveMarket.duelId,
          duelType: liveMarket.duelType,
          optionLabel,
          units: n,
          collateralMode: liveMarket.collateralMode,
        });

      let { res, data } = await tryWith();

      // Server said not started — short wait + one retry, else hand control back
      if (
        !res.ok &&
        (data.code === "MARKET_NOT_STARTED" || /not open yet|opens in/i.test(data.error || ""))
      ) {
        const until =
          data.opensAt ||
          (data.opensInMs != null ? Date.now() + data.opensInMs : Date.now() + 60_000);
        if (until > Date.now() + SHORT_WAIT_MS) {
          setOpensAt(until);
          void ensureNotifyPermission();
          const mins = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
          setStatus(
            `Market not open yet (~${mins} min). You’ll get a notification — then tap BET.`,
          );
          return;
        }
        setStatus(`Almost open — placing on “${picked}”…`);
        await waitUntilOpenShort(until);
        jwtFresh = await ensureToken();
        ({ res, data } = await tryWith());
      }

      // Only recreate when Bento says the binding is truly dead — not while warming
      const stillWarming = Boolean(openAt && openAt > Date.now());
      if (
        !res.ok &&
        isOwnLocalPrediction &&
        !stillWarming &&
        (data.code === "MARKET_DEAD" ||
          /status\s*=?\s*-1|paused|invalid|cancelled|canceled/i.test(data.error || ""))
      ) {
        setStatus("Prior market unusable — opening a fresh prediction…");
        const published = await publishLocal({ force: true });
        if (!published?.card.market) throw new Error(data.error || "Bet failed");
        live = published.card;
        liveMarket = published.card.market!;
        openAt = published.opensAt;
        if (openAt && openAt > Date.now() + SHORT_WAIT_MS) {
          setOpensAt(openAt);
          void ensureNotifyPermission();
          const mins = Math.max(1, Math.ceil((openAt - Date.now()) / 60_000));
          setStatus(
            `Fresh prediction ready. Opens in ~${mins} min — you’ll be notified, then tap BET on “${picked}”.`,
          );
          return;
        }
        if (openAt && openAt > Date.now()) await waitUntilOpenShort(openAt);
        jwtFresh = await ensureToken();
        ({ res, data } = await placeBetRequest({
          jwt: jwtFresh,
          duelId: liveMarket.duelId,
          duelType: liveMarket.duelType,
          optionLabel,
          units: n,
          collateralMode: liveMarket.collateralMode,
        }));
      }

      // Warming + status noise: surface countdown instead of a hard fail
      if (
        !res.ok &&
        stillWarming &&
        (data.code === "MARKET_DEAD" ||
          data.code === "MARKET_NOT_STARTED" ||
          /status\s*=?\s*-1|not open yet/i.test(data.error || ""))
      ) {
        setOpensAt(openAt);
        void ensureNotifyPermission();
        const mins = Math.max(1, Math.ceil((openAt! - Date.now()) / 60_000));
        setStatus(
          `Still warming (~${mins} min). You’ll get a notification — then tap BET on “${picked}”.`,
        );
        return;
      }

      if (!res.ok) throw new Error(data.error || "Bet failed");
      setOpensAt(null);
      setLiveBanner(null);
      // Optimistic metrics bump so SCOUTING METRICS / ATTRIBUTES move with the stake
      const withStake = applyStakeToCard(live, Number(data.units ?? n));
      pushCard(withStake);
      setStatus(
        `Bet saved on “${picked}” (${data.bet ?? optionLabel} · ${data.units ?? n} credits). Check MY BETS.`,
      );
      try {
        window.dispatchEvent(new Event(BETS_CHANGED_EVENT));
      } catch {
        /* ignore */
      }
      void refreshQuote();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Bet failed");
    } finally {
      setPlacing(false);
    }
  };

  const showTradeUi =
    isLoggedIn &&
    (canPlaceOnChain || isLocal || isOwnLocalPrediction) &&
    !isPolymarket &&
    !isDemo &&
    (!marketBlocked || isDeadLivePrediction || isOwnLocalPrediction);

  return (
    <div className="mt-3 w-full rounded-xl border border-line bg-white/[0.03] p-4">
      <div className="font-display text-[11px] font-bold tracking-[.22em] text-brand">
        PLACE A BET
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">
        {market.question || card.name}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-ink-faint">
        <span>
          {preferMarketDisplayCategory(
            market.category,
            card.login.startsWith("local-") ? "Hyper-Local" : null,
            `${market.description || ""}\n${market.question || ""}\n${card.name}`,
          )}
        </span>
        <span>·</span>
        <span className="font-mono">{market.duelId.slice(0, 12)}…</span>
        <span>·</span>
        <span>{market.collateralMode.toUpperCase()}</span>
        <span>·</span>
        <span>status {market.status}</span>
        <span>·</span>
        <span>endsIn {market.endsIn}</span>
        {isPolymarket && (
          <>
            <span>·</span>
            <span>Polymarket (view only)</span>
          </>
        )}
        {isLocal && (
          <>
            <span>·</span>
            <span>Hyper-local → open as prediction</span>
          </>
        )}
        {canPlaceOnChain && market.source === "bento" && card.login.startsWith("local-") && (
          <>
            <span>·</span>
            <span className="text-brand">Live prediction</span>
          </>
        )}
      </div>

      <div className="mt-3">
        <WalletSession wallet={wallet} compact={isLoggedIn} />
      </div>

      {liveBanner && (
        <div
          role="status"
          className="mt-3 rounded-xl border border-brand/50 bg-brand/15 px-3 py-3 shadow-[0_0_24px_rgba(57,211,83,.12)]"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-display text-[12px] font-bold tracking-[.16em] text-brand-hi">
                ● LIVE — BETTING OPEN
              </p>
              <p className="mt-1 text-[12.5px] leading-snug text-ink">
                {liveBanner.slice(0, 140)}
                {liveBanner.length > 140 ? "…" : ""}
              </p>
              <p className="mt-1 text-[11.5px] text-ink-soft">Place your stake now.</p>
            </div>
            <button
              type="button"
              onClick={() => setLiveBanner(null)}
              className="shrink-0 text-[11px] text-ink-faint hover:text-ink"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {waitLabel && !liveBanner && (
        <p className="mt-2 text-[12px] leading-snug text-brand-hi">{waitLabel}</p>
      )}
      {creditsHint && (
        <p className="mt-2 text-[11.5px] leading-snug text-ink-soft">{creditsHint}</p>
      )}
      {marketWarning && (
        <div className="mt-2 rounded-lg border border-gold-hi/30 bg-gold-hi/10 px-3 py-2.5">
          <p className="text-[12px] leading-snug text-gold-hi">
            {isDeadLivePrediction
              ? "Bento cancelled the last on-chain market (status=-1). Pick your side, stake, and tap RECREATE & BET — you’ll own the new prediction and can stake when it goes live."
              : marketWarning}
          </p>
          {isDeadLivePrediction ? (
            <button
              type="button"
              disabled={publishing || busy || placing}
              onClick={() => void publishLocal({ force: true })}
              className="font-display mt-2 inline-flex h-9 items-center rounded-md bg-brand px-3 text-[12px] tracking-wide text-[#04130a] hover:bg-brand-hi disabled:opacity-60"
            >
              {publishing ? "OPENING FRESH…" : "OPEN FRESH PREDICTION"}
            </button>
          ) : (
            marketBlocked && !isOwnLocalPrediction && (
              <Link
                href="/"
                className="font-display mt-2 inline-flex h-9 items-center rounded-md bg-brand px-3 text-[12px] tracking-wide text-[#04130a] hover:bg-brand-hi"
              >
                BROWSE LIVE MARKETS
              </Link>
            )
          )}
        </div>
      )}
      {isOwnLocalPrediction && !isDeadLivePrediction && canPlaceOnChain && (
        <p className="mt-2 text-[11.5px] text-ink-soft">
          This is your prediction — you can stake credits on either side once the market is open.
        </p>
      )}

      {isDemo && (
        <p className="mt-2 text-[11.5px] text-gold-hi/90">
          Demo card — scout a live Bento duelId to place real bets.
        </p>
      )}

      {isLocal && isLoggedIn && (
        <p className="mt-2 text-[11.5px] text-ink-soft">
          Creates a private Bento prediction (~5 min on-chain floor before bets open — Bento
          won’t accept an earlier startTime). When the countdown ends, tap BET.
          {market.externalUrl && (
            <>
              {" "}
              <a
                href={market.externalUrl}
                target="_blank"
                rel="noreferrer"
                className="text-brand underline-offset-2 hover:underline"
              >
                Source ↗
              </a>
            </>
          )}
        </p>
      )}
      {canPlaceOnChain && marketWarming && (
        <p className="mt-2 text-[11.5px] text-ink-soft">
          Prediction is warming up (~5 min Bento floor). Tap BET near the end of the countdown —
          we’ll wait up to ~2 min if it’s almost open.
        </p>
      )}

      {isLocal && !isLoggedIn && (
        <p className="mt-2 text-[11.5px] text-ink-soft">
          Sign in to open this local problem as a live prediction and place a stake.
        </p>
      )}

      {isPolymarket && (
        <p className="mt-2 text-[11.5px] text-ink-soft">
          Props & Futures from{" "}
          <a
            href={market.externalUrl || "https://testnet.bento.fun/markets"}
            target="_blank"
            rel="noreferrer"
            className="text-brand underline-offset-2 hover:underline"
          >
            Bento Markets
          </a>{" "}
          are scout-only here. Go back and pick a native Bento card (no{" "}
          <span className="font-mono">pm-</span> id) to place credits bets.
        </p>
      )}

      {showTradeUi && (
        <>
          {isLocal && (
            <button
              type="button"
              disabled={publishing || busy || placing}
              onClick={() => void publishLocal()}
              className="font-display mt-3 h-10 w-full rounded-lg border border-brand/40 bg-brand/10 text-[13px] tracking-wide text-brand-hi transition hover:bg-brand/20 disabled:opacity-60"
            >
              {publishing ? "OPENING PREDICTION…" : "OPEN AS LIVE PREDICTION"}
            </button>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2">
            {options.map((label, i) => (
              <button
                key={`${label}-${i}`}
                type="button"
                onClick={() => setOptionIndex(i)}
                className={`rounded-lg border px-2.5 py-2.5 text-left text-[12px] leading-snug transition ${
                  optionIndex === i
                    ? "border-brand bg-brand/15 text-brand-hi"
                    : "border-line bg-bg/40 text-ink-soft hover:border-brand/40"
                }`}
              >
                <span className="font-display block text-[10px] tracking-[.16em] opacity-80">
                  {i === 0 ? "YES" : "NO"}
                </span>
                <span className="mt-0.5 block font-medium">{label}</span>
              </button>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {STAKE_CHIPS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setAmount(String(n))}
                className={`font-mono rounded-md border px-2.5 py-1 text-[12px] transition ${
                  stakeUnits === n
                    ? "border-brand bg-brand/15 text-brand-hi"
                    : "border-line text-ink-soft hover:border-brand/40"
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          <div className="mt-2 flex gap-2">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              aria-label="Stake amount"
              placeholder={String(MIN_BET)}
              className="font-mono h-10 min-w-0 flex-1 rounded-lg border border-line bg-bg/80 px-3 text-[14px] text-white outline-none focus:border-brand"
            />
            <button
              type="button"
              disabled={
                placing ||
                publishing ||
                busy ||
                !amount.trim() ||
                Boolean(
                  !isDeadLivePrediction &&
                    !isOwnLocalPrediction &&
                    marketWarning &&
                    /ended|closed|paused|invalid|expire/i.test(marketWarning),
                )
              }
              onClick={() => void place()}
              className="font-display h-10 shrink-0 rounded-lg bg-brand px-4 text-[13px] tracking-wide text-[#04130a] hover:bg-brand-hi disabled:opacity-60"
            >
              {placing
                ? "BETTING…"
                : isDeadLivePrediction
                  ? "RECREATE & BET"
                  : isLocal || isOwnLocalPrediction
                    ? canPlaceOnChain
                      ? "BET"
                      : "CREATE & BET"
                    : "BET"}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-line bg-bg/50 px-3 py-2.5 text-[11.5px]">
            <div>
              <div className="font-display tracking-[.14em] text-ink-faint">STAKE</div>
              <div className="mt-0.5 font-mono text-ink">
                {stakeUnits >= MIN_BET ? stakeUnits : "—"}
              </div>
            </div>
            <div>
              <div className="font-display tracking-[.14em] text-ink-faint">ODDS</div>
              <div className="mt-0.5 font-mono text-ink">
                {quoting
                  ? "…"
                  : quote && quote.odds > 0
                    ? `${quote.odds.toFixed(2)}×`
                    : canPlaceOnChain
                      ? "—"
                      : "~2.00×"}
              </div>
            </div>
            <div>
              <div className="font-display tracking-[.14em] text-ink-faint">PAYOUT</div>
              <div className="mt-0.5 font-mono text-brand-hi">
                {quoting
                  ? "…"
                  : quote
                    ? `≈ ${quote.payoutIfWin.toFixed(2)}`
                    : canPlaceOnChain
                      ? "—"
                      : stakeUnits >= MIN_BET
                        ? `≈ ${(stakeUnits * 2).toFixed(0)}`
                        : "—"}
              </div>
            </div>
          </div>
          {quote && canPlaceOnChain && (
            <p className="mt-1.5 text-[11px] text-ink-faint">
              Implied {options[optionIndex]?.slice(0, 48) || (optionIndex === 0 ? "Yes" : "No")}{" "}
              {((optionIndex === 0 ? quote.yesPrice : quote.noPrice) * 100).toFixed(1)}% · avg{" "}
              {(quote.avgPrice * 100).toFixed(1)}¢ · {quote.sharesOut.toFixed(2)} shares if fills
            </p>
          )}
          {!canPlaceOnChain && isLocal && (
            <p className="mt-1.5 text-[11px] text-ink-faint">
              Odds/payout update from the live book after the prediction opens (opening books often
              start near even money).
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-ink-faint">
            Min {MIN_BET} credits. Winning side pays ≈ shares received. Bets sync to MY BETS via
            your Bento session.
          </p>
        </>
      )}

      {status && (
        <p
          className={`mt-2 text-[12px] leading-snug ${
            /saved|opened|accepted|Live prediction/i.test(status)
              ? "text-ink-soft"
              : "text-red-300"
          }`}
        >
          {status}
        </p>
      )}
    </div>
  );
}
