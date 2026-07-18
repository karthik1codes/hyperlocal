import { NextResponse } from "next/server";
import { getWeblinkUrl, sanitizeReturnUrl } from "@/lib/bento/weblink-auth";
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

    const returnUrl = sanitizeReturnUrl(
      body.returnUrl ||
        (() => {
          const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
          if (site) return `${site.replace("://localhost", "://127.0.0.1")}/auth/callback`;
          const host = (req.headers.get("x-forwarded-host") || new URL(req.url).host)
            .split(",")[0]
            .trim()
            .replace(/^localhost(?=:|$)/, "127.0.0.1");
          const proto = req.headers.get("x-forwarded-proto") || "http";
          return `${proto}://${host}/auth/callback`;
        })(),
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
