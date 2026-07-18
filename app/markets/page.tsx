import Background from "@/components/Background";
import AppShell from "@/components/AppShell";
import { getScoutCount } from "@/lib/analytics";
import { loadHomeCards } from "@/lib/scout";
import { listRecentLocalCards } from "@/lib/local/store";
import { SAMPLE_CARDS } from "@/lib/bento/samples";
import type { Card } from "@/lib/scoring/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Rate a Market — Bento Cards",
  description:
    "Turn live Bento markets into FUT-style player cards. Bet with Free-to-Play credits on native markets.",
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

/** Prefer live Bento markets, then local mints with art, then polished samples. */
function buildMarketsPack(bento: Card[], local: Card[], limit = 5): Card[] {
  const out: Card[] = [];
  const used = new Set<string>();

  const push = (c: Card) => {
    if (used.has(c.login) || isJunkTitle(c.name)) return;
    used.add(c.login);
    out.push(c);
  };

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

export default async function MarketsPage() {
  const [scoutCount, bentoCards, localCards] = await Promise.all([
    getScoutCount(),
    loadHomeCards(12),
    listRecentLocalCards(4),
  ]);
  const cards = buildMarketsPack(bentoCards, localCards, 5);
  return (
    <div className="relative min-h-screen overflow-x-hidden text-ink">
      <Background />
      <AppShell scoutCount={scoutCount} cards={cards} />
    </div>
  );
}
