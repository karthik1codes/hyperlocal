import "server-only";
import { getPublicSdk } from "./public-api";

/**
 * Official Bento weblink auth — mirrors docs exactly:
 *
 * ```ts
 * const { url } = await sdk.public.externalLink.getLinkUrl({
 *   returnUrl: 'https://your.app/callback',
 *   state: 'your-user-id',
 * });
 * // user opens url → returns to callback?code=…&state=…
 * const { token, state } = await sdk.public.externalLink.exchange({ code });
 * ```
 *
 * @see https://docs.bento.fun/concepts/authentication
 */

/** Bento `@IsUrl()` rejects `localhost`; rewrite to `127.0.0.1` for local dev. */
export function sanitizeReturnUrl(raw: string): string {
  const u = new URL(raw);
  if (u.hostname === "localhost") u.hostname = "127.0.0.1";
  if (!u.pathname || u.pathname === "/") u.pathname = "/auth/callback";
  u.hash = "";
  return u.toString();
}

/**
 * Callback URL for weblink auth — always the host the user is browsing
 * (localhost / preview / production). Never NEXT_PUBLIC_SITE_URL: that env is
 * for share links and would bounce local sign-in onto production.
 */
export function authCallbackUrlFromRequest(req: Request): string {
  const reqUrl = new URL(req.url);
  const xfHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const xfProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = (xfHost || reqUrl.host).replace(/^localhost(?=:|$)/i, "127.0.0.1");
  const proto = (xfProto || reqUrl.protocol.replace(":", "") || "http").replace(/:$/, "");
  return sanitizeReturnUrl(`${proto}://${host}/auth/callback`);
}

export async function getWeblinkUrl(opts: {
  returnUrl: string;
  state: string;
}): Promise<{ url: string; state: string | null }> {
  const returnUrl = sanitizeReturnUrl(opts.returnUrl);
  const { url, state } = await getPublicSdk().externalLink.getLinkUrl({
    returnUrl,
    state: opts.state,
  });
  return { url, state };
}

export async function exchangeWeblinkCode(code: string) {
  const { token, state, address, userId, username, expiresIn } =
    await getPublicSdk().externalLink.exchange({ code });
  return { token, state, address, userId, username, expiresIn };
}
