import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pins single-flight + read-through cache behaviour of scoutCard against the
// Bento scout bridge (fetchMarket is the expensive call we dedupe).
vi.mock("server-only", () => ({}));

const fetchMarket = vi.fn();
vi.mock("@/lib/bento/scout-bridge", () => ({
  fetchMarket: (u: string) => fetchMarket(u),
  hasBentoLive: () => true,
}));
vi.mock("@/lib/bento/config", () => ({
  hasBentoCredentials: () => true,
}));

const store = new Map<string, string>();
vi.mock("@/lib/redis", () => ({
  redis: {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => {
      store.set(k, v);
    },
  },
}));

import { scoutCard } from "@/lib/scout";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
// Non-demo ids so the sample short-circuit in scout.ts does not fire.
const payload = (login: string) => ({ login, name: login, overall: 80 });

beforeEach(() => {
  store.clear();
  fetchMarket.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("scoutCard single-flight", () => {
  it("collapses concurrent misses for the same login into one fetch", async () => {
    const d = deferred<ReturnType<typeof payload>>();
    fetchMarket.mockReturnValueOnce(d.promise);

    const calls = Promise.all([scoutCard("Market-A"), scoutCard("market-a"), scoutCard("MARKET-A")]);
    await flush();
    expect(fetchMarket).toHaveBeenCalledTimes(1);

    const p = payload("market-a");
    d.resolve(p);
    const [a, b, c] = await calls;
    expect(a).toEqual(p);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(fetchMarket).toHaveBeenCalledTimes(1);
  });

  it("fetches separately for different logins", async () => {
    fetchMarket.mockImplementation(async (u: string) => payload(u.toLowerCase()));
    await Promise.all([scoutCard("alice"), scoutCard("bob")]);
    expect(fetchMarket).toHaveBeenCalledTimes(2);
  });

  it("does not memoise failures — the next scout retries", async () => {
    fetchMarket.mockRejectedValueOnce({ type: "ratelimit", message: "limited" });
    await expect(scoutCard("market-a")).rejects.toMatchObject({ type: "ratelimit" });
    expect(fetchMarket).toHaveBeenCalledTimes(1);

    fetchMarket.mockResolvedValueOnce(payload("market-a"));
    await expect(scoutCard("market-a")).resolves.toMatchObject({ login: "market-a" });
    expect(fetchMarket).toHaveBeenCalledTimes(2);
  });

  it("serves a cached card without refetching", async () => {
    fetchMarket.mockResolvedValueOnce(payload("market-a"));
    await scoutCard("market-a");
    await scoutCard("market-a");
    await scoutCard("market-a");
    expect(fetchMarket).toHaveBeenCalledTimes(1);
  });

  it("refetches once the in-flight build has settled (window closed)", async () => {
    fetchMarket.mockResolvedValueOnce(payload("market-a"));
    await scoutCard("market-a");
    store.clear();
    fetchMarket.mockResolvedValueOnce(payload("market-a"));
    await scoutCard("market-a");
    expect(fetchMarket).toHaveBeenCalledTimes(2);
  });
});
