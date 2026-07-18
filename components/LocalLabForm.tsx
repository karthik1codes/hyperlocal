"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mic, MicOff } from "lucide-react";
import type { Card } from "@/lib/scoring/types";
import { writeCardCache } from "@/hooks/useScout";
import PlayerCard from "@/components/PlayerCard";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: {
    resultIndex: number;
    results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
  }) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

const EXAMPLES = [
  {
    region: "Chennai",
    topic: "Will Chennai Metro Phase 2 open for the public before December?",
  },
  {
    region: "Bengaluru",
    topic: "Whitefield metro corridor commute time",
  },
  {
    region: "Mumbai",
    topic: "Will coastal road Phase 2 open to private cars before year end?",
  },
];

const AUTO_TOPICS = [
  "breaking local news today",
  "city development update",
  "public transit latest",
  "local politics this week",
];

type ProgressLine = {
  step: string;
  label: string;
  detail?: string;
  at: number;
};

type Preview = {
  question: string;
  sharePath: string;
  summary: string;
  sourceUrl: string;
  imageUrl: string | null;
  whyItMatters?: string | null;
  category?: string | null;
  card: Card;
  audioUrl?: string | null;
  reused?: boolean;
};

function friendlyFetchError(raw: string, status?: number): string {
  const t = raw.trim();
  if (!t) return status ? `Research failed (HTTP ${status}).` : "Research failed.";
  if (/<!DOCTYPE|<html|This page couldn’t load|__next_error__/i.test(t)) {
    return "Cloud scrape hit a server error (Chrome isn’t available on Vercel). Retry — we’ll use Google News / Anakin instead.";
  }
  return t.length > 280 ? `${t.slice(0, 280)}…` : t;
}

async function runResearchStream(
  region: string,
  topic: string,
  onProgress: (line: ProgressLine) => void,
  signal?: AbortSignal,
): Promise<Preview> {
  const res = await fetch("/api/local/research/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ region, topic }),
    signal,
  });

  const contentType = res.headers.get("content-type") || "";
  if (!res.ok || !res.body || !/text\/event-stream|json/i.test(contentType)) {
    const fallback = await res.text().catch(() => "");
    throw new Error(friendlyFetchError(fallback, res.status));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let preview: Preview | null = null;
  let streamError: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";

    for (const chunk of chunks) {
      const line = chunk
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.startsWith("data:"));
      if (!line) continue;
      const raw = line.replace(/^data:\s*/, "");
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (msg.type === "progress") {
        onProgress({
          step: String(msg.step || ""),
          label: String(msg.label || ""),
          detail: typeof msg.detail === "string" ? msg.detail : undefined,
          at: typeof msg.at === "number" ? msg.at : Date.now(),
        });
      } else if (msg.type === "result" && msg.card && msg.sharePath && msg.question) {
        preview = {
          question: String(msg.question),
          sharePath: String(msg.sharePath),
          summary: String(msg.summary || ""),
          sourceUrl: String(msg.sourceUrl || ""),
          imageUrl: (msg.imageUrl as string | null) ?? null,
          whyItMatters: typeof msg.whyItMatters === "string" ? msg.whyItMatters : null,
          category: typeof msg.category === "string" ? msg.category : null,
          card: msg.card as Card,
          audioUrl: typeof msg.audioUrl === "string" ? msg.audioUrl : null,
          reused: Boolean(msg.reused),
        };
      } else if (msg.type === "error") {
        streamError = friendlyFetchError(String(msg.error || "Research failed"));
      }
    }
  }

  if (streamError) throw new Error(streamError);
  if (!preview) throw new Error("Stream ended without a card — retry once.");
  return preview;
}

export default function LocalLabForm({
  compact = false,
  onCardMinted,
}: {
  /** Hide intro copy when the parent page already explains the flow. */
  compact?: boolean;
  /** Notify parent (home fan) when a new prediction card is ready. */
  onCardMinted?: (card: Card) => void;
}) {
  const router = useRouter();
  const [region, setRegion] = useState("");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressLine[]>([]);
  const [cards, setCards] = useState<Preview[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSupported, setRecordSupported] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const autoTopicIdx = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setRecordSupported(Boolean(getSpeechRecognition()));
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [progress]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      audioRef.current?.pause();
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const stopRecording = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
    recognitionRef.current = null;
    setRecording(false);
  }, []);

  const toggleRecord = useCallback(() => {
    if (recording) {
      stopRecording();
      return;
    }
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setError("Voice recording isn’t supported in this browser. Try Chrome.");
      return;
    }
    audioRef.current?.pause();
    setSpeaking(false);
    setError(null);

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";
    recognition.onresult = (ev) => {
      let finalChunk = "";
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const piece = ev.results[i]![0]!.transcript;
        if (ev.results[i]!.isFinal) finalChunk += piece;
        else interim += piece;
      }
      if (finalChunk) {
        setTopic((prev) => {
          const base = prev.trim();
          const add = finalChunk.trim();
          if (!add) return prev;
          return base ? `${base} ${add}` : add;
        });
      } else if (interim) {
        // Live preview: keep typed base + interim in a soft way via data attribute only —
        // we update topic on finals to avoid fighting the caret. Show interim in status.
      }
    };
    recognition.onerror = (ev) => {
      const code = ev.error || "error";
      if (code !== "aborted" && code !== "no-speech") {
        setError(
          code === "not-allowed"
            ? "Microphone permission denied. Allow mic access to record."
            : `Recording failed (${code}).`,
        );
      }
      setRecording(false);
      recognitionRef.current = null;
    };
    recognition.onend = () => {
      setRecording(false);
      recognitionRef.current = null;
    };

    try {
      recognitionRef.current = recognition;
      recognition.start();
      setRecording(true);
    } catch {
      setError("Could not start the microphone. Check browser permissions.");
      setRecording(false);
      recognitionRef.current = null;
    }
  }, [recording, stopRecording]);

  const playBriefing = useCallback(async (url: string | null | undefined) => {
    if (!url) return;
    try {
      audioRef.current?.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      setSpeaking(true);
      audio.onended = () => setSpeaking(false);
      audio.onerror = () => setSpeaking(false);
      await audio.play();
    } catch {
      setSpeaking(false);
    }
  }, []);

  useEffect(() => {
    if (preview?.audioUrl) {
      void playBriefing(preview.audioUrl);
    }
  }, [preview?.sharePath, preview?.audioUrl, playBriefing]);

  const appendProgress = useCallback((line: ProgressLine) => {
    setProgress((prev) => [...prev.slice(-40), line]);
  }, []);

  const runOnce = useCallback(
    async (r: string, t: string) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setError(null);
      setBusy(true);
      setProgress([]);
      try {
        const next = await runResearchStream(r, t, appendProgress, ac.signal);
        setPreview(next);
        setCards((prev) => [next, ...prev].slice(0, 8));
        onCardMinted?.(next.card);
        // Keep the card in the browser so /local-* works even when Vercel
        // memory/Redis miss on the next request.
        writeCardCache(next.card);
        void fetch("/api/local/persist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            card: next.card,
            region: r,
            topic: t,
            question: next.question,
          }),
        }).catch(() => {
          /* best-effort */
        });
        // Auto-open the minted card (skip while live auto-fetch is rotating)
        if (next.sharePath && !auto) {
          router.push(next.sharePath);
        }
        return next;
      } catch (e) {
        if ((e as Error).name === "AbortError") return null;
        setError(e instanceof Error ? e.message : "Research failed");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [appendProgress, onCardMinted, router, auto],
  );

  const run = () => void runOnce(region, topic);

  // Auto mode: rotate local news topics for the region every ~90s after each card
  useEffect(() => {
    if (!auto) return;
    if (region.trim().length < 2) {
      setError("Enter a region before starting live auto-fetch.");
      setAuto(false);
      return;
    }

    let cancelled = false;
    const tick = async () => {
      while (!cancelled && auto) {
        const t =
          topic.trim().length >= 4
            ? topic.trim()
            : AUTO_TOPICS[autoTopicIdx.current % AUTO_TOPICS.length]!;
        autoTopicIdx.current += 1;
        await runOnce(region.trim(), t);
        if (cancelled || !auto) break;
        appendProgress({
          step: "wait",
          label: "Waiting for next live fetch…",
          detail: "≈ 90s",
          at: Date.now(),
        });
        await new Promise((r) => setTimeout(r, 90_000));
      }
    };
    void tick();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [auto, region, topic, runOnce, appendProgress]);

  const share = async (p: Preview) => {
    const { cardUrl } = await import("@/lib/share");
    const url = cardUrl(p.card);
    try {
      if (navigator.share) {
        await navigator.share({
          title: p.question,
          text: `Hyper-local prediction: ${p.question}`,
          url,
        });
        return;
      }
    } catch {
      /* fall through */
    }
    await navigator.clipboard.writeText(url);
  };

  return (
    <div className={`w-full ${compact ? "max-w-[720px]" : "mx-auto max-w-[720px]"}`}>
      {!compact && (
        <p className="mb-6 text-[15px] leading-relaxed text-ink-soft">
          Tell us your <span className="text-ink">city / region</span> and a{" "}
          <span className="text-ink">hyper-local problem</span>. On production we scrape via{" "}
          <span className="text-ink">Google News / Anakin</span> (no local Chrome on Vercel),
          then mint a FUT-style prediction card.
        </p>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={`${ex.region}-${ex.topic}`}
            type="button"
            onClick={() => {
              setRegion(ex.region);
            }}
            className="rounded-lg border border-line bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-ink-soft transition hover:border-brand/40 hover:text-ink"
          >
            {ex.region}
          </button>
        ))}
      </div>

      <label className="mb-3 block">
        <span className="font-display mb-1.5 block text-[11px] tracking-[.18em] text-brand">
          REGION
        </span>
        <input
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          placeholder="Chennai, District X, University Y…"
          className="h-11 w-full rounded-xl border border-line bg-bg/80 px-3 text-[15px] text-ink outline-none focus:border-brand"
        />
      </label>

      <label className="mb-2 block">
        <span className="font-display mb-1.5 block text-[11px] tracking-[.18em] text-brand">
          LOCAL PROBLEM / QUESTION
        </span>
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          rows={3}
          autoComplete="off"
          placeholder="Will the zoning law change to allow high-rises in District X?"
          className="w-full resize-y rounded-xl border border-line bg-bg/80 px-3 py-2.5 text-[15px] leading-snug text-ink outline-none focus:border-brand"
        />
        <span className="mt-1 block text-[11px] text-ink-faint">
          Leave blank in auto mode to rotate generic local news topics.
        </span>
      </label>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || auto || !recordSupported}
          onClick={toggleRecord}
          aria-pressed={recording}
          className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3.5 text-[13px] font-semibold transition ${
            recording
              ? "border-red-400/50 bg-red-500/15 text-red-200"
              : "border-line text-ink-soft hover:border-brand/40 hover:text-ink"
          } disabled:cursor-not-allowed disabled:opacity-45`}
        >
          {recording ? <MicOff size={16} aria-hidden /> : <Mic size={16} aria-hidden />}
          {recording ? "Stop recording" : "Record"}
          {recording && (
            <span className="relative flex h-1.5 w-1.5" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-400" />
            </span>
          )}
        </button>
        <span className="text-[11px] text-ink-faint">
          {recording
            ? "Listening… speak your local problem"
            : recordSupported
              ? "Speak your local problem into the mic"
              : "Voice record needs Chrome / Edge"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || auto || region.trim().length < 2 || topic.trim().length < 4}
          onClick={run}
          className="font-display h-11 rounded-xl bg-brand px-5 text-[14px] tracking-wide text-[#04130a] transition hover:bg-brand-hi disabled:cursor-not-allowed disabled:opacity-55"
        >
          {busy ? "Fetching…" : "Create prediction card"}
        </button>
        <button
          type="button"
          disabled={region.trim().length < 2}
          onClick={() => setAuto((v) => !v)}
          className={`h-11 rounded-xl border px-4 text-[13px] font-semibold transition ${
            auto
              ? "border-brand/50 bg-brand/15 text-brand-hi"
              : "border-line text-ink-soft hover:border-brand/40 hover:text-ink"
          }`}
        >
          {auto ? "Stop live auto-fetch" : "Start live auto-fetch"}
        </button>
      </div>

      {(busy || progress.length > 0) && (
        <div className="mt-5 overflow-hidden rounded-2xl border border-brand/20 bg-[#06140c]/90">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
            <div className="font-display text-[11px] tracking-[.2em] text-brand">
              LIVE FETCH
            </div>
            {busy && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-brand-hi">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
                </span>
                Fetching
              </span>
            )}
          </div>
          <div className="max-h-48 space-y-1.5 overflow-y-auto px-3 py-2 font-mono text-[11.5px] leading-snug">
            {progress.length === 0 && busy && (
              <p className="text-ink-faint">Starting research stream…</p>
            )}
            {progress.map((p, i) => (
              <div key={`${p.at}-${i}`} className="text-ink-soft">
                <span className="text-brand/80">[{p.step}]</span> {p.label}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-[13px] leading-snug text-red-200">
          {error}
        </p>
      )}

      {preview && (
        <div className="mt-8 rounded-2xl border border-brand/25 bg-white/[0.03] p-4">
          <div className="font-display text-[11px] tracking-[.2em] text-brand">
            {preview.reused ? "EXISTING CARD" : "YOUR CARD"}
          </div>
          {preview.reused && (
            <p className="mt-2 text-[12px] text-ink-soft">
              This local problem was already rated — opened the existing prediction.
            </p>
          )}
          {preview.card.cardImageUrl ? (
            <div className="mx-auto mt-4 w-full max-w-[280px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview.card.cardImageUrl}
                alt={preview.card.name}
                className="w-full drop-shadow-[0_16px_40px_rgba(0,0,0,.55)]"
                style={{ aspectRatio: "540 / 820", objectFit: "contain" }}
              />
            </div>
          ) : preview.card.avatarUrl || preview.imageUrl ? (
            <div className="mx-auto mt-4 w-full max-w-[280px] drop-shadow-[0_16px_40px_rgba(0,0,0,.55)]">
              <PlayerCard
                card={{
                  ...preview.card,
                  avatarUrl: preview.card.avatarUrl || preview.imageUrl || preview.card.avatarUrl,
                }}
              />
            </div>
          ) : null}
          <h2 className="mt-5 text-[18px] font-semibold leading-snug text-ink">
            {preview.question}
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{preview.summary}</p>
          {preview.whyItMatters && (
            <p className="mt-2 text-[12.5px] leading-snug text-brand-hi/90">
              {preview.whyItMatters}
            </p>
          )}
          {preview.category && (
            <p className="mt-1 text-[11px] text-ink-faint">{preview.category}</p>
          )}
          {preview.sourceUrl && (
            <a
              href={preview.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-[12px] text-brand underline-offset-2 hover:underline"
            >
              Source article ↗
            </a>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => router.push(preview.sharePath)}
              className="font-display rounded-lg bg-brand px-4 py-2 text-[12px] tracking-wide text-[#04130a]"
            >
              Open card
            </button>
            {preview.audioUrl && (
              <button
                type="button"
                onClick={() => {
                  if (speaking) {
                    audioRef.current?.pause();
                    setSpeaking(false);
                    return;
                  }
                  void playBriefing(preview.audioUrl);
                }}
                className={`rounded-lg border px-4 py-2 text-[12px] font-semibold transition ${
                  speaking
                    ? "border-brand/50 bg-brand/15 text-brand-hi"
                    : "border-line text-ink-soft hover:border-brand/40 hover:text-ink"
                }`}
              >
                {speaking ? "Stop briefing" : "Listen (TTS)"}
              </button>
            )}
            <button
              type="button"
              onClick={() => void share(preview)}
              className="rounded-lg border border-line px-4 py-2 text-[12px] font-semibold text-ink-soft hover:border-brand/40 hover:text-ink"
            >
              Share with friends
            </button>
            <Link
              href={preview.sharePath}
              className="rounded-lg border border-line px-4 py-2 text-[12px] font-mono text-ink-faint"
            >
              {preview.sharePath}
            </Link>
          </div>
          <p className="mt-3 text-[11px] text-ink-faint">
            Opening card… OVR {preview.card.overall} · {preview.card.finishLabel}
          </p>
        </div>
      )}

      {cards.length > 1 && (
        <div className="mt-8">
          <div className="font-display mb-3 text-[11px] tracking-[.2em] text-brand">
            SESSION CARDS
          </div>
          <ul className="space-y-2">
            {cards.map((c) => (
              <li key={c.sharePath}>
                <Link
                  href={c.sharePath}
                  className="block rounded-xl border border-line bg-white/[0.02] px-3 py-2.5 transition hover:border-brand/35"
                >
                  <p className="line-clamp-2 text-[13px] font-medium text-ink">{c.question}</p>
                  <p className="mt-1 text-[11px] text-ink-faint">
                    OVR {c.card.overall} · {c.card.finishLabel}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
