import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeWeblinkCode } from "@/lib/bento/weblink-auth";
import { mintTestnetCredits, type BentoAuthSession } from "@/lib/bento/actions";
import { hasBentoCredentials } from "@/lib/bento/config";

export const dynamic = "force-dynamic";

/**
 * After `/auth/callback?code=&state=`:
 * `const { token, state } = await sdk.public.externalLink.exchange({ code })`
 * then fund managed account via auto-mint faucet.
 *
 * @see https://docs.bento.fun/concepts/authentication
 * @see https://docs.bento.fun/concepts/money#testnet-faucet-register-does-not-fund-you
 */
export async function POST(req: Request) {
  if (!hasBentoCredentials()) {
    return NextResponse.json(
      { error: "Set BENTO_BUILDER_API_KEY to enable Bento login." },
      { status: 503 },
    );
  }

  try {
    const body = (await req.json()) as { code?: string; state?: string | null };
    if (!body.code?.trim()) {
      return NextResponse.json({ error: "code is required" }, { status: 400 });
    }

    const cookieStore = await cookies();
    const cookieState = cookieStore.get("bento_weblink_state")?.value;

    // Docs: const { token, state } = await sdk.public.externalLink.exchange({ code })
    const exchanged = await exchangeWeblinkCode(body.code.trim());

    if (!exchanged.token || !exchanged.address) {
      return NextResponse.json(
        { error: "Bento exchange did not return token/address" },
        { status: 400 },
      );
    }

    const expected = body.state || cookieState;
    if (expected && exchanged.state && expected !== exchanged.state) {
      return NextResponse.json({ error: "state mismatch" }, { status: 400 });
    }

    // Docs: register/login does NOT fund you — mint to managed address
    const mint = await mintTestnetCredits(exchanged.address);
    const faucetMinted = mint.ok;

    const session: BentoAuthSession = {
      token: exchanged.token,
      exists: true,
      signingAddress: exchanged.address,
      managedAddress: exchanged.address,
      username: exchanged.username || null,
      faucetMinted,
    };

    const res = NextResponse.json({
      ok: true,
      ...session,
      faucetMessage: mint.message,
      userId: exchanged.userId,
      state: exchanged.state,
      expiresIn: exchanged.expiresIn,
    });
    res.cookies.set("bento_weblink_state", "", { path: "/", maxAge: 0 });
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Exchange failed" },
      { status: 400 },
    );
  }
}
