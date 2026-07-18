import "server-only";
import { scoutCard, loadHomeCards } from "@/lib/scout";
import type { Card } from "@/lib/scoring/types";
import type { ClubState } from "@/lib/club/types";
import { gatherEvidence } from "./evidence";
import { runStructuredDebate } from "./agents";
import type { DebateResult } from "./types";

async function polishWithLlm(result: DebateResult): Promise<DebateResult | null> {
  const key = process.env.OPENAI_API_KEY || process.env.BENTO_DEBATE_LLM_KEY;
  if (!key) return null;

  const base =
    process.env.OPENAI_BASE_URL?.replace(/\/$/, "") || "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const prompt = {
    question: result.question,
    optionA: result.optionA,
    optionB: result.optionB,
    verdict: result.verdict,
    bull: result.arguments.find((a) => a.agentId === "bull"),
    bear: result.arguments.find((a) => a.agentId === "bear"),
    risk: result.arguments.find((a) => a.agentId === "risk"),
    evidence: result.evidence.map((e) => ({
      id: e.id,
      label: e.label,
      detail: e.detail,
      weight: e.weight,
      source: e.source,
    })),
  };

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are the Judge in a prediction-market debate. Keep the structured pick (A/B/PASS) unless evidence clearly contradicts it. Return JSON: { summary, whyAccurate: string[], disagreements: string[], caveats: string[] }. Be concrete and cite evidence labels. No guarantees of profit.",
          },
          {
            role: "user",
            content: JSON.stringify(prompt),
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      summary?: string;
      whyAccurate?: string[];
      disagreements?: string[];
      caveats?: string[];
    };

    return {
      ...result,
      mode: "structured+llm",
      verdict: {
        ...result.verdict,
        summary: parsed.summary || result.verdict.summary,
        whyAccurate:
          Array.isArray(parsed.whyAccurate) && parsed.whyAccurate.length
            ? parsed.whyAccurate
            : result.verdict.whyAccurate,
        disagreements:
          Array.isArray(parsed.disagreements) && parsed.disagreements.length
            ? parsed.disagreements
            : result.verdict.disagreements,
        caveats:
          Array.isArray(parsed.caveats) && parsed.caveats.length
            ? parsed.caveats
            : result.verdict.caveats,
      },
    };
  } catch {
    return null;
  }
}

async function resolveCard(input: {
  login?: string;
  duelId?: string;
  card?: Card;
}): Promise<Card> {
  if (input.card?.login) return input.card;
  const id = (input.login || input.duelId || "").trim();
  if (!id) throw new Error("Pass login, duelId, or a card snapshot.");
  return scoutCard(id);
}

/**
 * Full Club debate: ingest evidence → Bull / Bear / Risk → Judge
 * (+ optional OpenAI polish when OPENAI_API_KEY is set).
 */
export async function runClubDebate(input: {
  login?: string;
  duelId?: string;
  card?: Card;
  club?: ClubState | null;
}): Promise<DebateResult> {
  const card = await resolveCard(input);
  const catalog = await loadHomeCards(16).catch(() => [] as Card[]);
  const related = catalog.filter(
    (c) =>
      c.market?.category &&
      card.market?.category &&
      c.market.category === card.market.category,
  );

  const evidence = gatherEvidence(card, input.club, related.length ? related : catalog);
  const structured = runStructuredDebate(card, evidence);
  const base: DebateResult = {
    ...structured,
    mode: "structured",
    ranAt: Date.now(),
  };

  const polished = await polishWithLlm(base);
  return polished ?? base;
}
