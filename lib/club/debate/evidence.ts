import type { Card } from "@/lib/scoring/types";
import type { ClubState } from "@/lib/club/types";
import { squadList } from "@/lib/club/squad";
import type { EvidenceItem } from "./types";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Gather auditable evidence from the card, Bento market tape, and club book.
 * Weights lean toward option A (positive) or B (negative).
 */
export function gatherEvidence(
  card: Card,
  club?: ClubState | null,
  related: Card[] = [],
): EvidenceItem[] {
  const m = card.market;
  const items: EvidenceItem[] = [];
  const opts = m?.options?.length ? m.options : ["Yes", "No"];

  items.push({
    id: "card-ovr",
    source: "card",
    label: "Card overall",
    detail: `${card.name} rates ${card.overall} OVR (${card.finishLabel}, ${card.archetype}). Higher OVR markets tend to have clearer tape.`,
    weight: clamp((card.overall - 75) / 20, -1.2, 1.2),
  });

  items.push({
    id: "stat-pac",
    source: "card",
    label: "PAC — momentum",
    detail: `Pace ${card.stats.pac}/99 — recent activity. Fast tape favors acting sooner, not waiting for a perfect narrative.`,
    weight: clamp((card.stats.pac - 70) / 25, -1, 1),
  });

  items.push({
    id: "stat-sho",
    source: "card",
    label: "SHO — volume / punch",
    detail: `Shooting ${card.stats.sho}/99 — pool size and punch. Thin SHO books punish late size.`,
    weight: clamp((card.stats.sho - 70) / 25, -1, 1.2),
  });

  items.push({
    id: "stat-pas",
    source: "card",
    label: "PAS — participation",
    detail: `Passing ${card.stats.pas}/99 — unique participants / social reach. Crowded books are harder to edge.`,
    weight: clamp((70 - card.stats.pas) / 30, -0.8, 0.8),
  });

  items.push({
    id: "stat-def",
    source: "card",
    label: "DEF — depth of review",
    detail: `Defense ${card.stats.def}/99 — engagement depth. Low DEF means thin research trail.`,
    weight: clamp((card.stats.def - 65) / 30, -0.7, 0.7),
  });

  if (m) {
    const vol = Number(m.totalBetAmountUsdc || 0);
    items.push({
      id: "bento-volume",
      source: "bento",
      label: "Market volume",
      detail: `On-book volume ≈ ${vol.toLocaleString("en-US")} (${m.collateralMode}). ${
        vol < 50 ? "Thin liquidity — size carefully." : "Decent depth for Free-to-Play size."
      }`,
      weight: clamp(Math.log10(Math.max(vol, 1)) / 4 - 0.5, -1.2, 1.2),
      url: m.externalUrl || null,
    });

    items.push({
      id: "bento-participants",
      source: "bento",
      label: "Unique participants",
      detail: `${m.uniqueParticipants} unique bettors. Very low counts → noisy prices.`,
      weight: clamp(Math.log10(Math.max(m.uniqueParticipants, 1)) / 3 - 0.4, -1, 1),
    });

    const ends = Number(m.endsIn ?? 0);
    items.push({
      id: "bento-timing",
      source: "bento",
      label: "Time left (endsIn)",
      detail: `endsIn=${ends}. ${
        ends < 1
          ? "Market is nearly done — late information risk is extreme."
          : ends < 12
            ? "Short clock — momentum (PAC) matters more than deep research."
            : "Enough runway for a researched view."
      }`,
      weight: ends < 1 ? -1.5 : ends < 12 ? -0.4 : 0.3,
    });

    items.push({
      id: "bento-status",
      source: "bento",
      label: "Market status",
      detail: `status=${m.status}, type=${m.duelType}, mode=${m.collateralMode}. Options: ${opts.join(" vs ")}.`,
      weight: Number(m.status) >= 2 ? -2 : Number(m.status) < 0 ? -0.3 : 0.2,
    });

    if (m.question) {
      items.push({
        id: "bento-question",
        source: "bento",
        label: "Market question",
        detail: m.question,
        weight: 0,
        url: m.externalUrl || null,
      });
    }

    if (m.source === "polymarket") {
      items.push({
        id: "poly-note",
        source: "external",
        label: "Polymarket snapshot",
        detail:
          "This card is a Polymarket view/scout snapshot — odds context only; native Bento duels are where credits settle.",
        weight: -0.2,
        url: m.externalUrl || null,
      });
    }
  }

  if (club) {
    const squad = squadList(club);
    const sameCat = squad.filter(
      (c) =>
        c.login !== card.login &&
        c.market?.category &&
        c.market.category === card.market?.category,
    );
    if (sameCat.length) {
      items.push({
        id: "club-corr",
        source: "club",
        label: "Club correlation",
        detail: `Already holding ${sameCat.length} card(s) in ${card.market?.category}: ${sameCat
          .map((c) => c.name)
          .slice(0, 3)
          .join(", ")}. Stacked exposure raises portfolio risk.`,
        weight: -0.6 * Math.min(sameCat.length, 3),
      });
    } else if (squad.length) {
      items.push({
        id: "club-div",
        source: "club",
        label: "Club diversification",
        detail: `Squad has ${squad.length} markets; none share this category — cleaner book.`,
        weight: 0.25,
      });
    }
  }

  const peers = related
    .filter((c) => c.login !== card.login)
    .slice(0, 4);
  if (peers.length) {
    const peerOvr =
      peers.reduce((s, c) => s + c.overall, 0) / Math.max(peers.length, 1);
    items.push({
      id: "catalog-peers",
      source: "catalog",
      label: "Peer markets",
      detail: `Nearby catalog peers avg OVR ${peerOvr.toFixed(0)}: ${peers
        .map((c) => `${c.name} (${c.overall})`)
        .join("; ")}. Relative strength vs peers informs edge.`,
      weight: clamp((card.overall - peerOvr) / 15, -1, 1),
    });
  }

  return items;
}

export function optionLabels(card: Card): { optionA: string; optionB: string } {
  const opts = card.market?.options?.length ? card.market.options : ["Yes", "No"];
  return {
    optionA: opts[0] || "Yes",
    optionB: opts[1] || "No",
  };
}
