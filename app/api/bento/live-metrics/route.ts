import { NextResponse } from "next/server";
import { hasBentoCredentials } from "@/lib/bento/config";
import { fetchMarket } from "@/lib/bento/client";
import { marketMetaFromDuel, signalsFromDuel } from "@/lib/bento/signals";
import { isLiveRefreshableDuelId } from "@/lib/bento/merge-live-card";
import { buildCard } from "@/lib/scoring/engine";
import { formatBentoError } from "@/lib/bento/actions";

export const dynamic = "force-dynamic";

/**
 * Fresh scouting metrics / attributes for a live Bento duel.
 * Used after create & bet so the report tracks book volume & traders.
 */
export async function GET(req: Request) {
  if (!hasBentoCredentials()) {
    return NextResponse.json({ error: "Bento not configured." }, { status: 503 });
  }

  const url = new URL(req.url);
  const duelId = (url.searchParams.get("duelId") || "").trim();
  const userAddress = url.searchParams.get("address") || undefined;

  if (!isLiveRefreshableDuelId(duelId)) {
    return NextResponse.json({ error: "Expected a live Bento duelId." }, { status: 400 });
  }

  try {
    const duel = await fetchMarket(duelId, {
      userAddress:
        userAddress && /^0x[a-fA-F0-9]{40}$/.test(userAddress) ? userAddress : undefined,
    });
    const card = buildCard(signalsFromDuel(duel));
    const market = marketMetaFromDuel(duel);
    return NextResponse.json({
      ok: true,
      card: { ...card, market: { ...market, source: "bento" as const } },
    });
  } catch (e) {
    const message = formatBentoError(e) || "Could not refresh market metrics.";
    console.error("[bento/live-metrics]", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
