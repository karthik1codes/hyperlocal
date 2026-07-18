import { NextResponse } from "next/server";
import { estimateAndPlaceBet, formatBentoError } from "@/lib/bento/actions";
import { hasBentoCredentials } from "@/lib/bento/config";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(req: Request) {
  if (!hasBentoCredentials()) {
    return NextResponse.json(
      { error: "Set BENTO_BUILDER_API_KEY to place bets." },
      { status: 503 },
    );
  }
  try {
    const body = (await req.json()) as {
      token?: string;
      duelId?: string;
      optionIndex?: number;
      amount?: string;
      duelType?: string;
      optionLabel?: string;
      address?: string;
      collateralMode?: "credits" | "usdc";
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
    if (body.duelId.startsWith("demo-") || body.duelId.startsWith("pm-") || body.duelId.startsWith("local-")) {
      return NextResponse.json(
        {
          error:
            "Only live Bento duelIds support placeBet. Open a market from the home fan.",
        },
        { status: 400 },
      );
    }
    const result = await estimateAndPlaceBet({
      token: body.token,
      duelId: body.duelId,
      optionIndex: body.optionIndex as 0 | 1,
      amount: body.amount,
      duelType: body.duelType,
      optionLabel: body.optionLabel,
      address: body.address,
      collateralMode: body.collateralMode,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = formatBentoError(e) || "Bet failed";
    console.error("[bento/bet]", message);
    const opensInMs =
      e && typeof e === "object" && "opensInMs" in e && typeof (e as { opensInMs?: unknown }).opensInMs === "number"
        ? (e as { opensInMs: number }).opensInMs
        : undefined;
    const opensAt =
      e && typeof e === "object" && "opensAt" in e && typeof (e as { opensAt?: unknown }).opensAt === "number"
        ? (e as { opensAt: number }).opensAt
        : undefined;
    return NextResponse.json(
      {
        error: message,
        code:
          e && typeof e === "object" && "code" in e
            ? (e as { code?: string }).code
            : undefined,
        opensInMs,
        opensAt,
      },
      { status: 400 },
    );
  }
}
