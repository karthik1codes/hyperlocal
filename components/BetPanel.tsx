"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Card } from "@/lib/scoring/types";
import { isMarketTradeable } from "@/lib/bento/tradeable";
import { useBentoWallet } from "@/hooks/useBentoWallet";
import WalletSession from "@/components/WalletSession";
import { BETS_CHANGED_EVENT } from "@/components/BetsSidebar";

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

export default function BetPanel({ card: initialCard }: { card: Card }) {
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

  const isPolymarket = market?.source === "polymarket";
  const isLocal =
    market?.source === "local" || Boolean(market?.duelId?.startsWith("local-"));
  const isDemo = Boolean(market?.duelId?.startsWith("demo-"));
  const canPlaceOnChain = Boolean(market && !isPolymarket && !isLocal && !isDemo);

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

  useEffect(() => {
    if (!opensAt) {
      setWaitLabel(null);
      return;
    }
    const tick = () => {
      const left = opensAt - Date.now();
      if (left <= 0) {
        setWaitLabel(null);
        return;
      }
      const m = Math.floor(left / 60_000);
      const s = Math.ceil((left % 60_000) / 1000);
      setWaitLabel(
        m > 0 ? `Opens in ${m}m ${s}s — bet will send automatically` : `Opens in ${s}s…`,
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [opensAt]);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const waitUntilOpen = useCallback(async (until: number) => {
    setOpensAt(until);
    while (Date.now() < until) {
      await sleep(Math.min(5_000, until - Date.now()));
    }
    setOpensAt(null);
    // small buffer for Bento clock skew
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

  const publishLocal = useCallback(async (): Promise<{
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
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        card?: Card;
        duelId?: string;
        warning?: string;
        opensInMs?: number;
      };
      if (!res.ok || !data.card?.market) {
        throw new Error(data.error || "Could not open live prediction");
      }
      setCard(data.card);
      const delay = data.opensInMs ?? 6 * 60_000;
      const openAt = Date.now() + delay;
      setOpensAt(openAt);
      const mins = Math.max(1, Math.round(delay / 60_000));
      setStatus(
        `Private prediction ready (${data.duelId?.slice(0, 14) ?? "ok"}…). Opens in ~${mins} min — waiting, then betting on your pick.`,
      );
      return { card: data.card, opensAt: openAt };
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not open prediction");
      return null;
    } finally {
      setPublishing(false);
    }
  }, [card, ensureToken, setError, managedAddress, signingAddress]);

  if (!market) return null;

  const place = async () => {
    setStatus(null);
    setError(null);
    setPlacing(true);
    try {
      let live = card;
      let liveMarket = live.market!;
      let openAt: number | null = opensAt;

      if (isLocal) {
        const published = await publishLocal();
        if (!published?.card.market) throw new Error("Open the live prediction first.");
        live = published.card;
        liveMarket = published.card.market!;
        openAt = published.opensAt;
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

      // If market isn't open yet, wait on the client (Bento requires future startTime)
      if (openAt && openAt > Date.now() + 2_000) {
        setStatus(`Waiting to bet on: ${picked}`);
        await waitUntilOpen(openAt);
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

      // Server said not started — wait then retry once (refresh JWT in case wait was long)
      if (
        !res.ok &&
        (data.code === "MARKET_NOT_STARTED" || /not open yet|opens in/i.test(data.error || ""))
      ) {
        const until =
          data.opensAt ||
          (data.opensInMs != null ? Date.now() + data.opensInMs : Date.now() + 60_000);
        setStatus(`Waiting to bet on: ${picked}`);
        await waitUntilOpen(until);
        jwtFresh = await ensureToken();
        ({ res, data } = await tryWith());
      }

      if (!res.ok) throw new Error(data.error || "Bet failed");
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
      setOpensAt(null);
    }
  };

  const showTradeUi =
    isLoggedIn &&
    (canPlaceOnChain || isLocal) &&
    !isPolymarket &&
    !isDemo &&
    !marketBlocked;

  return (
    <div className="mt-3 w-full rounded-xl border border-line bg-white/[0.03] p-4">
      <div className="font-display text-[11px] font-bold tracking-[.22em] text-brand">
        PLACE A BET
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">
        {market.question || card.name}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-ink-faint">
        <span>{market.category}</span>
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

      {waitLabel && (
        <p className="mt-2 text-[12px] leading-snug text-brand-hi">{waitLabel}</p>
      )}
      {creditsHint && (
        <p className="mt-2 text-[11.5px] leading-snug text-ink-soft">{creditsHint}</p>
      )}
      {marketWarning && (
        <div className="mt-2 rounded-lg border border-gold-hi/30 bg-gold-hi/10 px-3 py-2.5">
          <p className="text-[12px] leading-snug text-gold-hi">{marketWarning}</p>
          {marketBlocked && (
            <Link
              href="/"
              className="font-display mt-2 inline-flex h-9 items-center rounded-md bg-brand px-3 text-[12px] tracking-wide text-[#04130a] hover:bg-brand-hi"
            >
              BROWSE LIVE MARKETS
            </Link>
          )}
        </div>
      )}

      {isDemo && (
        <p className="mt-2 text-[11.5px] text-gold-hi/90">
          Demo card — scout a live Bento duelId to place real bets.
        </p>
      )}

      {isLocal && isLoggedIn && (
        <p className="mt-2 text-[11.5px] text-ink-soft">
          Creates a private Bento prediction (skips public bootstrap), then bets when it opens —
          usually ~6 min (on-chain floor). Keep this tab open; CREATE &amp; BET waits automatically.
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
                Boolean(marketWarning && /ended|closed|paused|invalid|expire/i.test(marketWarning))
              }
              onClick={() => void place()}
              className="font-display h-10 shrink-0 rounded-lg bg-brand px-4 text-[13px] tracking-wide text-[#04130a] hover:bg-brand-hi disabled:opacity-60"
            >
              {placing ? (waitLabel ? "WAITING TO OPEN…" : "BETTING…") : isLocal ? "CREATE & BET" : "BET"}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-line bg-bg/50 px-3 py-2.5 text-[11.5px]">
            <div>
              <div className="font-display tracking-[.14em] text-ink-faint">STAKE</div>
              <div className="mt-0.5 font-mono text-ink">
                {stakeUnits >= MIN_BET ? stakeUnits : "—"} cr
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
