import Background from "@/components/Background";
import HyperLocalShell from "@/components/HyperLocalShell";
import { getScoutCount } from "@/lib/analytics";
import { listRecentLocalCards } from "@/lib/local/store";
import { SAMPLE_CARDS } from "@/lib/bento/samples";
import { SITE } from "@/lib/share";
import type { Card } from "@/lib/scoring/types";

// Dynamic so the live scout count + recent local cards stay fresh per load.
export const dynamic = "force-dynamic";

const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE}/#website`,
      url: SITE,
      name: "Bento Cards",
      description:
        "Rate hyper-local problems as FUT-style player cards — news fetch, Gemini draft, shareable scout ratings.",
    },
    {
      "@type": "WebApplication",
      name: "Bento Cards",
      url: SITE,
      applicationCategory: "EntertainmentApplication",
      operatingSystem: "Web",
      browserRequirements: "Requires JavaScript",
      description:
        "Turn city-level news into FIFA-Ultimate-Team-style prediction cards rated out of 99.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
  ],
};

/** Feature the Bengaluru CM prediction ahead of other local mints (e.g. zoning). */
function isFeaturedLocal(card: Card): boolean {
  const q = `${card.login} ${card.market?.question || ""} ${card.name}`.toLowerCase();
  return (
    q.includes("who-will-be-the-next") ||
    q.includes("chief minister") ||
    q.includes("chiefminister")
  );
}

function pinFeaturedFirst(cards: Card[]): Card[] {
  const featured = cards.find(isFeaturedLocal);
  if (!featured) return cards;
  return [featured, ...cards.filter((c) => c.login !== featured.login)];
}

export default async function Home() {
  let scoutCount: number | null = null;
  let recentCards: Card[] = [];
  try {
    [scoutCount, recentCards] = await Promise.all([
      getScoutCount(),
      listRecentLocalCards(8),
    ]);
  } catch (e) {
    console.error(
      "[home] fetch failed — using sample pack:",
      e instanceof Error ? e.stack || e.message : e,
    );
  }
  // Keep a fanned pack on the side even before the first local mint.
  const sideCards = pinFeaturedFirst(
    recentCards.length >= 3
      ? recentCards
      : [...recentCards, ...SAMPLE_CARDS].slice(0, 5),
  );

  return (
    <div className="relative min-h-screen overflow-x-hidden text-ink">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <Background />
      <HyperLocalShell scoutCount={scoutCount} initialCards={sideCards} />
    </div>
  );
}
