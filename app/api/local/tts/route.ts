import { NextResponse } from "next/server";
import { hasOpenAICredentials, speakLocalProblemWithOpenAI } from "@/lib/local/openai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * On-demand OpenAI TTS briefing for a local problem / prediction.
 * POST { region, topic, question, summary?, whyItMatters?, overall?, finishLabel? }
 */
export async function POST(req: Request) {
  try {
    if (!hasOpenAICredentials()) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY required for TTS." },
        { status: 400 },
      );
    }
    const body = (await req.json()) as {
      region?: string;
      topic?: string;
      question?: string;
      summary?: string;
      whyItMatters?: string;
      overall?: number;
      finishLabel?: string;
    };
    const region = body.region?.trim() || "";
    const topic = body.topic?.trim() || "";
    const question = body.question?.trim() || "";
    if (region.length < 2 || topic.length < 2 || question.length < 8) {
      return NextResponse.json(
        { error: "region, topic, and question are required." },
        { status: 400 },
      );
    }

    const audioUrl = await speakLocalProblemWithOpenAI({
      region,
      topic,
      question,
      summary: body.summary || null,
      whyItMatters: body.whyItMatters || null,
      overall: body.overall,
      finishLabel: body.finishLabel,
    });

    if (!audioUrl) {
      return NextResponse.json(
        { error: "OpenAI TTS failed. Check OPENAI_TTS_MODEL / quota." },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, audioUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : "TTS failed";
    console.error("[local/tts]", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
