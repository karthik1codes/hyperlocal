import { NextResponse } from "next/server";
import { authedSdk } from "@/lib/bento/client";
import {
  getCreditsBalance,
  getFaucetStatus,
  mintTestnetCredits,
} from "@/lib/bento/money";
import { hasBentoCredentials } from "@/lib/bento/config";

export const dynamic = "force-dynamic";

/** Faucet status + optional remint + credits balance for the managed account. */
export async function POST(req: Request) {
  if (!hasBentoCredentials()) {
    return NextResponse.json({ error: "Missing BENTO_BUILDER_API_KEY" }, { status: 503 });
  }

  try {
    const body = (await req.json()) as {
      token?: string;
      address?: string;
      mint?: boolean;
    };
    const faucet = await getFaucetStatus();
    let mint = null as Awaited<ReturnType<typeof mintTestnetCredits>> | null;
    let balance: number | null = null;

    if (body.mint && body.address) {
      mint = await mintTestnetCredits(body.address);
    }

    if (body.token && body.address) {
      const sdk = authedSdk(body.token);
      balance = await getCreditsBalance(sdk, body.address);
    }

    return NextResponse.json({
      ok: true,
      faucet,
      mint,
      balance,
      canBet: balance == null || balance >= 5,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Credits check failed" },
      { status: 400 },
    );
  }
}

export async function GET() {
  if (!hasBentoCredentials()) {
    return NextResponse.json({ error: "Missing BENTO_BUILDER_API_KEY" }, { status: 503 });
  }
  const faucet = await getFaucetStatus();
  return NextResponse.json({ ok: true, faucet });
}
