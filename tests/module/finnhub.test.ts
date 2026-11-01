import { describe, expect, it } from "vitest";
import { finnhubProvider } from "../../src/night/sources/finnhub";

// Replies are shaped like Finnhub's, with invented tickers and figures.
type Reply = { status?: number; body?: unknown } | Error;

function fakeFinnhub(routes: Record<string, Reply | Reply[]>) {
  const requests: { url: URL; token: string | null; at: number }[] = [];
  let now = 0;
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({ url, token: new Headers(init?.headers).get("X-Finnhub-Token"), at: now });
    const route = routes[url.pathname.replace("/api/v1", "")];
    const reply = Array.isArray(route) ? (route.length > 1 ? route.shift()! : route[0]) : route;
    if (!reply) return new Response("not found", { status: 404 });
    if (reply instanceof Error) throw reply;
    return Response.json(reply.body ?? {}, { status: reply.status ?? 200 });
  };
  const provider = finnhubProvider({
    apiKey: "test-key-not-real",
    fetch: fetch as typeof globalThis.fetch,
    clock: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  return { provider, requests };
}

describe("The Finnhub market data provider", () => {
  it("reads a quote, sending the key in a header and never in the address", async () => {
    const { provider, requests } = fakeFinnhub({ "/quote": { body: { c: 41.5, pc: 40, d: 1.5, t: 1 } } });

    expect(await provider.quote("ZZAA.B")).toEqual({ price: 41.5, previousClose: 40 });
    expect(requests[0].url.searchParams.get("symbol")).toBe("ZZAA.B");
    expect(requests[0].token).toBe("test-key-not-real");
    expect(requests[0].url.toString()).not.toContain("test-key-not-real");
  });

  it("treats an all-zero quote as an unknown ticker", async () => {
    const { provider } = fakeFinnhub({ "/quote": { body: { c: 0, pc: 0, d: null, t: 0 } } });

    expect(await provider.quote("ZZZZ")).toBeNull();
  });

  it("reads the key facts and market cap, leaving out anything missing, zero-less or not a number", async () => {
    const { provider } = fakeFinnhub({
      "/stock/metric": {
        body: {
          metric: {
            marketCapitalization: 120500.5,
            forwardPE: 18.2,
            forwardPEG: "n/a",
            grossMarginTTM: 56.1,
            operatingMarginTTM: -3.5,
            revenueGrowthTTMYoy: 0,
            "totalDebt/totalEquityQuarterly": null,
          },
        },
      },
    });

    expect(await provider.metrics("ZZAA")).toEqual({
      marketCap: 120500.5,
      forwardPe: 18.2,
      peg: null,
      grossMargin: 56.1,
      // A negative margin and zero growth are real figures, not missing ones.
      operatingMargin: -3.5,
      revenueGrowth: 0,
      debtToEquity: null,
    });
  });

  it("returns no figures for a ticker Finnhub doesn't know", async () => {
    const { provider } = fakeFinnhub({ "/stock/metric": { body: { metric: {} } } });

    expect(await provider.metrics("ZZZZ")).toMatchObject({ marketCap: null, forwardPe: null });
  });

  it("reads monthly analyst rating counts, newest first", async () => {
    const { provider } = fakeFinnhub({
      "/stock/recommendation": {
        body: [
          { period: "2026-10-01", strongBuy: 3, buy: 5, hold: 4, sell: 1, strongSell: 0, symbol: "ZZAA" },
          { period: "2026-11-01", strongBuy: 4, buy: 6, hold: 3, sell: 1, strongSell: 0, symbol: "ZZAA" },
        ],
      },
    });

    expect(await provider.ratings("ZZAA")).toEqual([
      { period: "2026-11-01", strongBuy: 4, buy: 6, hold: 3, sell: 1, strongSell: 0 },
      { period: "2026-10-01", strongBuy: 3, buy: 5, hold: 4, sell: 1, strongSell: 0 },
    ]);
  });

  it("reads the whole market's earnings calendar in one call", async () => {
    const { provider, requests } = fakeFinnhub({
      "/calendar/earnings": {
        body: {
          earningsCalendar: [
            { symbol: "ZZAA", date: "2026-11-03", epsActual: 1.2, epsEstimate: 1.1, hour: "bmo" },
            { symbol: "ZZAB", date: "2026-11-04", epsActual: null, epsEstimate: 0.5, hour: "amc" },
          ],
        },
      },
    });

    expect(await provider.earningsCalendar("2026-11-03", "2026-11-04")).toEqual([
      { ticker: "ZZAA", date: "2026-11-03", epsActual: 1.2, epsEstimate: 1.1 },
      { ticker: "ZZAB", date: "2026-11-04", epsActual: null, epsEstimate: 0.5 },
    ]);
    expect(requests[0].url.searchParams.get("from")).toBe("2026-11-03");
    expect(requests[0].url.searchParams.get("to")).toBe("2026-11-04");
  });

  it("reads company news with its source and time", async () => {
    const { provider } = fakeFinnhub({
      "/company-news": {
        body: [
          {
            headline: "Fictional Co opens a plant",
            source: "Fictional Wire",
            url: "https://news.example.test/1",
            datetime: 1793664000,
          },
        ],
      },
    });

    expect(await provider.news("ZZAA", "2026-11-01", "2026-11-03")).toEqual([
      {
        headline: "Fictional Co opens a plant",
        source: "Fictional Wire",
        url: "https://news.example.test/1",
        publishedAt: "2026-11-03T00:00:00.000Z",
      },
    ]);
  });

  it("starts requests at least 1.1 seconds apart, to stay within 60 calls a minute", async () => {
    const { provider, requests } = fakeFinnhub({ "/quote": { body: { c: 1, pc: 1 } } });

    await provider.quote("ZZAA");
    await provider.quote("ZZAB");
    await provider.quote("ZZAC");

    expect(requests.map((r) => r.at)).toEqual([0, 1100, 2200]);
  });

  it("waits and tries again when the rate limit is hit or a request fails", async () => {
    const { provider, requests } = fakeFinnhub({
      "/quote": [{ status: 429 }, new Error("socket hang up"), { status: 502 }, { body: { c: 7, pc: 6 } }],
    });

    expect(await provider.quote("ZZAA")).toEqual({ price: 7, previousClose: 6 });
    expect(requests).toHaveLength(4);
    // After a 429 it waits a full minute before trying again.
    expect(requests[1].at - requests[0].at).toBeGreaterThanOrEqual(60_000);
  });

  it("fails with a clear error, naming the endpoint, once retries run out", async () => {
    const { provider } = fakeFinnhub({ "/quote": { status: 500 } });

    await expect(provider.quote("ZZAA")).rejects.toThrow("Finnhub quote for ZZAA: HTTP 500");
  });

  it("fails at once on a refused key", async () => {
    const { provider, requests } = fakeFinnhub({ "/quote": { status: 401 } });

    await expect(provider.quote("ZZAA")).rejects.toThrow("Finnhub quote for ZZAA: HTTP 401 (check FINNHUB_API_KEY)");
    expect(requests).toHaveLength(1);
  });

  it("fails on a reply in an unexpected shape", async () => {
    const { provider } = fakeFinnhub({ "/stock/recommendation": { body: { error: "nope" } } });

    await expect(provider.ratings("ZZAA")).rejects.toThrow("Finnhub ratings for ZZAA: unexpected reply");
  });
});
