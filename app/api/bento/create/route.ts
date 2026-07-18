import { NextResponse } from "next/server";
import { createVersusMarket } from "@/lib/bento/actions";
import { hasBentoCredentials } from "@/lib/bento/config";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!hasBentoCredentials()) {
    return NextResponse.json(
      { error: "Set BENTO_BUILDER_API_KEY to create markets." },
      { status: 503 },
    );
  }
  try {
    const body = (await req.json()) as {
      token?: string;
      optionA?: string;
      optionB?: string;
      question?: string;
      category?: string;
      description?: string;
    };
    if (!body.token || !body.optionA || !body.optionB) {
      return NextResponse.json(
        { error: "token, optionA, optionB required" },
        { status: 400 },
      );
    }
    const result = await createVersusMarket({
      token: body.token,
      optionA: body.optionA,
      optionB: body.optionB,
      question: body.question,
      category: body.category,
      description: body.description,
    });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "Create failed" },
      { status: 400 },
    );
  }
}
