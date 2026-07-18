import { NextResponse } from "next/server";
import { formatBentoError, listUserBets } from "@/lib/bento/actions";
import { hasBentoCredentials } from "@/lib/bento/config";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!hasBentoCredentials()) {
    return NextResponse.json(
      { error: "Set BENTO_BUILDER_API_KEY to load bets." },
      { status: 503 },
    );
  }
  try {
    const body = (await req.json()) as { token?: string; address?: string };
    if (!body.token || !body.address) {
      return NextResponse.json(
        { error: "token and address required" },
        { status: 400 },
      );
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(body.address)) {
      return NextResponse.json({ error: "Invalid address" }, { status: 400 });
    }
    const result = await listUserBets({
      token: body.token,
      address: body.address,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = formatBentoError(e) || "Failed to load bets";
    console.error("[bento/bets]", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
