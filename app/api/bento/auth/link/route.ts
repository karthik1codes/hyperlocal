import { NextResponse } from "next/server";
import {
  authCallbackUrlFromRequest,
  getWeblinkUrl,
  sanitizeReturnUrl,
} from "@/lib/bento/weblink-auth";
import { hasBentoCredentials } from "@/lib/bento/config";

export const dynamic = "force-dynamic";

/**
 * Step 1 — mint connect URL:
 * `sdk.public.externalLink.getLinkUrl({ returnUrl, state })`
 */
export async function POST(req: Request) {
  if (!hasBentoCredentials()) {
    return NextResponse.json(
      { error: "Set BENTO_BUILDER_API_KEY to enable Bento login." },
      { status: 503 },
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      returnUrl?: string;
      state?: string;
    };

    // Prefer explicit body returnUrl, else the request host — never production
    // SITE_URL when developing locally (that bounced users to Vercel after sign-in).
    const returnUrl = sanitizeReturnUrl(
      body.returnUrl || authCallbackUrlFromRequest(req),
    );
    const state = body.state || `bento-cards-${Date.now().toString(36)}`;

    // Docs: const { url } = await sdk.public.externalLink.getLinkUrl({ returnUrl, state })
    const { url, state: echoed } = await getWeblinkUrl({ returnUrl, state });

    return NextResponse.json({
      ok: true,
      url, // testnet: https://testnet.bento.fun/connect?lt=…
      state: echoed ?? state,
      returnUrl,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not start Bento login" },
      { status: 400 },
    );
  }
}
