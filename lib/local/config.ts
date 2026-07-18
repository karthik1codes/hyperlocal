import "server-only";

/** `local` = Playwright on this machine · `anakin` = remote · `http` = fetch-only */
export type NewsBrowserMode = "local" | "anakin" | "http";

/** Vercel / Lambda — no system Chrome, no Playwright browsers. */
export function isServerlessRuntime(): boolean {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.FUNCTION_NAME ||
      process.env.K_SERVICE,
  );
}

export function anakinApiKey(): string | undefined {
  const raw = process.env.ANAKIN_API_KEY?.trim() || undefined;
  return raw?.replace(/\s+/g, "") || undefined;
}

export function hasAnakinCredentials(): boolean {
  return Boolean(anakinApiKey());
}

export function newsBrowserMode(): NewsBrowserMode {
  const raw = (process.env.LOCAL_NEWS_BROWSER || process.env.NEWS_BROWSER || "")
    .trim()
    .toLowerCase();
  // Vercel/Lambda has no Chrome — never honor `local` there (that 500s the API).
  if (isServerlessRuntime()) {
    if (raw === "http") return "http";
    if (raw === "anakin" || hasAnakinCredentials()) return "anakin";
    return "http";
  }
  if (raw === "anakin" || raw === "http" || raw === "local") return raw as NewsBrowserMode;
  return "local";
}

/** True only when we should launch Playwright Chrome/Edge on this machine. */
export function preferLocalBrowser(): boolean {
  return newsBrowserMode() === "local" && !isServerlessRuntime();
}

/** Research always works via HTTP; Anakin/local are upgrades. */
export function canResearchNews(): boolean {
  return true;
}

export function anakinBrowserWsUrl(): string {
  return (
    process.env.ANAKIN_BROWSER_WS?.replace(/\/$/, "") ||
    "wss://api.anakin.io/v1/browser-connect"
  );
}

/**
 * Open a visible Chrome window with real tabs (local only; ignored on Vercel).
 * Set LOCAL_NEWS_HEADED=false for headless.
 */
export function localBrowserHeaded(): boolean {
  if (isServerlessRuntime()) return false;
  const v = (process.env.LOCAL_NEWS_HEADED || "true").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "no");
}

/** Fall back to Anakin when local crawl fails (launch, empty results, extract errors). */
export function localAllowAnakinFallback(): boolean {
  const v = (process.env.LOCAL_NEWS_ANAKIN_FALLBACK || "true").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "no");
}
