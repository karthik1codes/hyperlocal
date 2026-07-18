import "server-only";

/** `local` = Playwright on this machine · `anakin` = remote CDP */
export type NewsBrowserMode = "local" | "anakin";

export function newsBrowserMode(): NewsBrowserMode {
  const raw = (process.env.LOCAL_NEWS_BROWSER || process.env.NEWS_BROWSER || "local")
    .trim()
    .toLowerCase();
  return raw === "anakin" ? "anakin" : "local";
}

/** Anakin Browser API — CDP WebSocket for Playwright. */
export function anakinApiKey(): string | undefined {
  const raw = process.env.ANAKIN_API_KEY?.trim() || undefined;
  return raw?.replace(/\s+/g, "") || undefined;
}

export function hasAnakinCredentials(): boolean {
  return Boolean(anakinApiKey());
}

/** Research works with local Chromium/Chrome, or Anakin when mode=anakin + key. */
export function canResearchNews(): boolean {
  if (newsBrowserMode() === "local") return true;
  return hasAnakinCredentials();
}

export function anakinBrowserWsUrl(): string {
  return (
    process.env.ANAKIN_BROWSER_WS?.replace(/\/$/, "") ||
    "wss://api.anakin.io/v1/browser-connect"
  );
}

/**
 * Open a visible Chrome window with real tabs (default ON).
 * Set LOCAL_NEWS_HEADED=false for headless.
 */
export function localBrowserHeaded(): boolean {
  const v = (process.env.LOCAL_NEWS_HEADED || "true").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "no");
}

/** Fall back to Anakin when local crawl fails (launch, empty results, extract errors). */
export function localAllowAnakinFallback(): boolean {
  const v = (process.env.LOCAL_NEWS_ANAKIN_FALLBACK || "true").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "no");
}
