import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Legacy EOA (MetaMask) login — disabled.
 * Use POST /api/bento/auth/link → Bento weblink → /auth/callback → exchange.
 * @see https://docs.bento.fun/concepts/authentication
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "EOA / MetaMask login is disabled. Use Sign in with Bento (weblink) from the header.",
      weblink: "/api/bento/auth/link",
    },
    { status: 410 },
  );
}
