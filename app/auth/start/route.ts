import { NextResponse } from "next/server";
import { getWeblinkUrl, sanitizeReturnUrl } from "@/lib/bento/weblink-auth";
import { hasBentoCredentials } from "@/lib/bento/config";

export const dynamic = "force-dynamic";

/**
 * Server-side weblink start — avoids `?bento_login=1` client hop / Strict Mode races.
 *
 * Flow (docs):
 * 1. getLinkUrl({ returnUrl, state })
 * 2. redirect to url (testnet.bento.fun/connect?lt=…)
 * 3. Bento returns to /auth/callback?code=&state=
 * 4. exchange({ code }) + auto-mint faucet
 *
 * @see https://docs.bento.fun/concepts/authentication
 */
export async function GET(req: Request) {
  if (!hasBentoCredentials()) {
    return NextResponse.redirect(new URL("/?auth_error=missing_builder_key", req.url));
  }

  try {
    const reqUrl = new URL(req.url);
    // Prefer public site URL; always sanitize localhost → 127.0.0.1 for Bento @IsUrl
    const site =
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
      `${reqUrl.protocol}//${reqUrl.host}`;
    const returnUrl = sanitizeReturnUrl(`${site}/auth/callback`);
    const state = `bento-cards-${crypto.randomUUID()}`;

    const { url, state: echoed } = await getWeblinkUrl({ returnUrl, state });
    const connectUrl = url;
    if (!connectUrl) {
      return NextResponse.redirect(new URL("/?auth_error=no_connect_url", req.url));
    }

    const res = NextResponse.redirect(connectUrl);
    // Persist state for CSRF check on callback (httpOnly cookie)
    res.cookies.set("bento_weblink_state", echoed || state, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10,
      // local http — secure false
      secure: returnUrl.startsWith("https://"),
    });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "login_failed";
    const dest = new URL("/", req.url);
    // Keep user on 127.0.0.1 if we started from localhost-sanitized flow
    try {
      const sanitized = sanitizeReturnUrl(dest.toString());
      dest.host = new URL(sanitized).host;
    } catch {
      /* keep */
    }
    dest.searchParams.set("auth_error", msg.slice(0, 120));
    return NextResponse.redirect(dest);
  }
}
