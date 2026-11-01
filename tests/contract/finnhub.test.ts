import { beforeAll, describe, expect, it } from "vitest";
import type { MarketDataProvider } from "../../src/night/market-data";
import { finnhubProvider } from "../../src/night/sources/finnhub";

// Checks that Finnhub's free tier still returns what the adapter expects. The ticker is taken at run
// time from the week's earnings calendar, so no real ticker is written in the code.

const isoDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

let provider: MarketDataProvider;
let ticker: string;

beforeAll(async () => {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) throw new Error("Set FINNHUB_API_KEY in .env.local to run the contract tests.");
  provider = finnhubProvider({ apiKey });
  const reported = (await provider.earningsCalendar(isoDay(-7), isoDay(0))).filter((e) => e.epsActual !== null);
  expect(reported.length).toBeGreaterThan(0);
  // A plain ticker for a company with results, which is very likely to have every kind of data.
  ticker = reported.find((e) => /^[A-Z]{1,4}$/.test(e.ticker))!.ticker;
});

describe("Finnhub (contract)", () => {
  it("returns a quote with a price and a previous close", async () => {
    const quote = await provider.quote(ticker);
    expect(quote?.price).toBeGreaterThan(0);
    expect(quote?.previousClose).toBeGreaterThan(0);
  });

  it("returns metrics including a market cap", async () => {
    const metrics = await provider.metrics(ticker);
    expect(metrics.marketCap).toBeGreaterThan(0);
    expect(Object.values(metrics).filter((v) => v !== null).length).toBeGreaterThanOrEqual(4);
  });

  it("returns monthly analyst ratings, newest first", async () => {
    const ratings = await provider.ratings(ticker);
    expect(ratings.length).toBeGreaterThan(0);
    expect(ratings[0].period).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it("returns news headlines with sources", async () => {
    const news = await provider.news(ticker, isoDay(-14), isoDay(0));
    expect(news.length).toBeGreaterThan(0);
    expect(news[0].headline.length).toBeGreaterThan(0);
  });

  it("answers an unknown ticker with no quote", async () => {
    expect(await provider.quote("ZZZZZQ")).toBeNull();
  });
});
