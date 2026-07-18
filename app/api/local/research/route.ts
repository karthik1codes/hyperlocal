import { NextResponse } from "next/server";
import { createHyperLocalPrediction } from "@/lib/local";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { region?: string; topic?: string };
    const region = body.region?.trim() || "";
    const topic = body.topic?.trim() || "";
    if (region.length < 2 || topic.length < 4) {
      return NextResponse.json(
        {
          error:
            "Tell us your city/region and a local problem (e.g. Chennai + Metro Phase 2 opening date).",
        },
        { status: 400 },
      );
    }
    if (region.length > 80 || topic.length > 200) {
      return NextResponse.json({ error: "Region or topic too long." }, { status: 400 });
    }

    const bundle = await createHyperLocalPrediction({ region, topic });
    return NextResponse.json({
      ok: true,
      login: bundle.login,
      question: bundle.question,
      region: bundle.region,
      topic: bundle.topic,
      sharePath: bundle.sharePath,
      sourceUrl: bundle.hit.url,
      sourceHost: bundle.hit.sourceHost,
      summary: bundle.hit.summary,
      imageUrl: bundle.card.cardImageUrl || bundle.hit.imageUrl,
      card: bundle.card,
      audioUrl: bundle.audioUrl || null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Research failed";
    const stack = e instanceof Error ? e.stack : undefined;
    console.error("[local/research]", message);
    if (stack) console.error(stack);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
