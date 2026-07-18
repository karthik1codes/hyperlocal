import { after } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import Background from "@/components/Background";
import { type ScoutError } from "@/lib/scout";
import { loadCard } from "@/lib/scout";
import { pickFlag } from "@/lib/flagPriority";
import { recordScout } from "@/lib/analytics";
import type { Card } from "@/lib/scoring/types";
import ScoutRoute from "./ScoutRoute";
import LocalCardHydrate from "./LocalCardHydrate";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const res = await loadCard(username);
  if ("card" in res) {
    return {
      title: `${res.card.name} — ${res.card.overall} ${res.card.finishLabel} · Bento Cards`,
      description: `${res.card.name} on Bento Cards: ${res.card.overall} OVR ${res.card.position}, ${res.card.archetype}.`,
      alternates: { canonical: `/${res.card.login}` },
      twitter: { card: "summary_large_image" },
    };
  }
  return { title: `@${username} · Bento Cards`, robots: { index: false } };
}

function NotScouted({ username, error }: { username: string; error: ScoutError }) {
  const rateLimited = error.type === "ratelimit";
  const isLocal = username.trim().replace(/^@/, "").toLowerCase().startsWith("local-");
  const heading = rateLimited
    ? "The scouts are gassed"
    : isLocal
      ? "Card not saved"
      : "No market found";
  const message = rateLimited
    ? `You lot went viral and stormed the training ground all at once — give the scouts a couple minutes to catch their breath, then send @${username} back on.`
    : isLocal
      ? "This hyper-local card expired or never reached durable storage. Mint again from the lab, then Create & bet to open a live Bento market."
      : error.type === "notfound"
        ? `There's no Bento market named @${username}.`
        : error.type === "invalid"
          ? `“${username}” isn't a valid market id.`
          : error.type === "config"
            ? "Bento isn't configured yet — set BENTO_BUILDER_API_KEY, or try a demo market."
            : error.message;
  return (
    <main className="relative z-[2] mx-auto flex min-h-screen max-w-[560px] flex-col items-center justify-center px-6 text-center">
      <div className="font-display text-[12px] font-bold tracking-[.3em] text-brand">SCOUT REPORT</div>
      <h1 className="font-display mt-3 text-[clamp(30px,6vw,48px)] font-black leading-[.95]">
        {heading}
      </h1>
      <p className="mt-3 text-[15.5px] leading-[1.5] text-ink-soft">{message}</p>
      <Link
        href={isLocal ? "/" : "/"}
        className="font-display mt-7 inline-flex h-[46px] items-center rounded-xl bg-brand px-6 text-[16px] tracking-[.06em] text-[#04130a] transition hover:bg-brand-hi"
      >
        {rateLimited
          ? "BACK TO THE BENCH"
          : isLocal
            ? "BACK TO HYPER-LOCAL LAB"
            : "TRY ANOTHER MARKET"}
      </Link>
    </main>
  );
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ country?: string }>;
}) {
  const { username } = await params;
  const { country: override } = await searchParams;
  const res = await loadCard(username);
  let card: Card | null = "card" in res ? res.card : null;
  let canonicalCountry = "";
  if (card) {
    after(() => recordScout());
    canonicalCountry = pickFlag(null, card.country) ?? "";
    const displayCountry = pickFlag(override, card.country) ?? "";
    card = { ...card, country: displayCountry };
  }

  const isLocal =
    username.trim().replace(/^@/, "").toLowerCase().startsWith("local-");
  const isLocalMiss =
    !card &&
    isLocal &&
    (res as { error?: ScoutError }).error?.type === "notfound";

  return (
    <div className="relative min-h-screen overflow-x-hidden text-ink">
      <Background />
      {card ? (
        <ScoutRoute card={card} canonicalCountry={canonicalCountry} />
      ) : isLocalMiss ? (
        <LocalCardHydrate login={username} />
      ) : (
        <NotScouted username={username} error={(res as { error: ScoutError }).error} />
      )}
    </div>
  );
}
