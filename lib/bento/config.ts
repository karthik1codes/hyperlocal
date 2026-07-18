import "server-only";

/**
 * Markets API host for https://testnet.bento.fun/markets
 * (website proxies at /api → same public duel catalog).
 */
export function bentoBaseUrl(): string {
  return (
    process.env.BENTO_URL?.replace(/\/$/, "") ||
    process.env.NEXT_PUBLIC_BENTO_URL?.replace(/\/$/, "") ||
    "https://testnet.bento.fun/api"
  );
}

/**
 * @deprecated Prefer bentoBaseUrl() — Polymarket gamma uses BENTO_URL + builder key.
 */
export function polymarketProxyBaseUrl(): string {
  return bentoBaseUrl();
}

export function bentoBuilderApiKey(): string | undefined {
  return process.env.BENTO_BUILDER_API_KEY || process.env.NEXT_PUBLIC_BENTO_BUILDER_API_KEY || undefined;
}

/** Headers for Bento / Polymarket proxy reads (`x-builder-api-key`). */
export function bentoBuilderHeaders(extra?: HeadersInit): HeadersInit {
  const apiKey = bentoBuilderApiKey();
  return {
    Accept: "application/json",
    ...(apiKey ? { "x-builder-api-key": apiKey } : {}),
    ...extra,
  };
}

export function hasBentoCredentials(): boolean {
  return Boolean(bentoBuilderApiKey());
}

/** Default collateral for demo / play money. */
export const DEFAULT_COLLATERAL: "credits" | "usdc" = "credits";
