import { NextResponse } from "next/server";
import { estimateBetQuote, formatBentoError } from "@/lib/bento/actions";
import { hasBentoCredentials } from "@/lib/bento/config";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!hasBentoCredentials()) {
    return NextResponse.json(
      { error: "Set BENTO_BUILDER_API_KEY to estimate bets." },
      { status: 503 },
    );
  }
  try {
    const body = (await req.json()) as {
      token?: string;
      duelId?: string;
      optionIndex?: number;
      amount?: string;
      address?: string;
    };
    if (!body.token || !body.duelId || body.optionIndex === undefined || !body.amount) {
      return NextResponse.json(
        { error: "token, duelId, optionIndex, amount required" },
        { status: 400 },
      );
    }
    if (body.optionIndex !== 0 && body.optionIndex !== 1) {
      return NextResponse.json({ error: "optionIndex must be 0 or 1" }, { status: 400 });
    }
    const quote = await estimateBetQuote({
      token: body.token,
      duelId: body.duelId,
      optionIndex: body.optionIndex === 0 ? 0 : 1,
      amount: body.amount,
      address: body.address,
    });
    return NextResponse.json({ ok: true, quote });
  } catch (e) {
    return NextResponse.json(
      { error: formatBentoError(e) },
      { status: 400 },
    );
  }
}
