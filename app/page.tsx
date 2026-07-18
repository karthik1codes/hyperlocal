import Background from "@/components/Background";
import HyperLocalShell from "@/components/HyperLocalShell";
import { getScoutCount } from "@/lib/analytics";
import { loadHomeCards } from "@/lib/scout";
import { listRecentLocalCards } from "@/lib/local/store";
import { SAMPLE_CARDS } from "@/lib/bento/samples";
import { siteOrigin } from "@/lib/share";
import type { Card } from "@/lib/scoring/types";

// Dynamic so the live scout count + recent local cards stay fresh per load.
export const dynamic = "force-dynamic";

const SITE = siteOrigin();

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

function isJunkTitle(name: string): boolean {
  const t = name.trim();
  if (t.length < 8) return true;
  if (/\[demo/i.test(t)) return true;
  if (/swipebet/i.test(t)) return true;
  if (/dependency/i.test(t)) return true;
  if (/pre-start betting/i.test(t)) return true;
  if (/qa lifecycle/i.test(t)) return true;
  return false;
}

/** Feature the Bengaluru CM prediction ahead of other local mints (e.g. zoning). */
function isFeaturedLocal(card: Card): boolean {
  const q = `${card.login} ${card.market?.question || ""} ${card.name}`.toLowerCase();
  return (
    q.includes("who-will-be-the-next") ||
    q.includes("chief minister") ||
    q.includes("chiefminister")
  );
}

/**
 * Side pack: recent hyper-local mints first, then live Bento markets —
 * same SideCardFan design as before (no separate /markets CardFan page).
 */
function buildHomePack(local: Card[], bento: Card[], limit = 5): Card[] {
  const out: Card[] = [];
  const used = new Set<string>();
  const push = (c: Card) => {
    if (used.has(c.login) || isJunkTitle(c.name)) return;
    used.add(c.login);
    out.push(c);
  };

  const featured = local.find(isFeaturedLocal);
  if (featured) push(featured);

  for (const c of local) {
    push(c);
    if (out.length >= Math.min(3, limit)) break;
  }
  for (const c of bento) {
    push(c);
    if (out.length >= limit) return out;
  }
  for (const c of local) {
    push(c);
    if (out.length >= limit) return out;
  }
  for (const c of SAMPLE_CARDS) {
    push(c);
    if (out.length >= limit) return out;
  }
  return out;
}

export default async function Home() {
  let scoutCount: number | null = null;
  let recentLocal: Card[] = [];
  let bentoCards: Card[] = [];
  try {
    [scoutCount, recentLocal, bentoCards] = await Promise.all([
      getScoutCount(),
      listRecentLocalCards(8),
      loadHomeCards(10),
    ]);
  } catch (e) {
    console.error(
      "[home] fetch failed — using sample pack:",
      e instanceof Error ? e.stack || e.message : e,
    );
  }

  const sideCards = buildHomePack(recentLocal, bentoCards, 5);

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
