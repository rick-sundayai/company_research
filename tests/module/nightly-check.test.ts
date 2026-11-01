import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listCompanies } from "../../src/lib/companies";
import { companyFacts } from "../../src/lib/facts";
import { recentRuns } from "../../src/lib/nightly-runs";
import {
  fictionalCompanies,
  HARBOR_LANE,
  QUILLFEATHER,
  type FictionalCompany,
} from "../support/fake-constituent-source";
import { fakeMarketData, unreadableMarketData, type FakeTicker } from "../support/fake-market-data";
import {
  createTestResearcher,
  forgetResearchData,
  forgetTestEmails,
  readLocalSupabase,
} from "../support/local-supabase";
import { runTestNight } from "../support/nights";

const stack = readLocalSupabase();
const createdEmails: string[] = [];
let researcher: SupabaseClient;

beforeAll(async () => {
  researcher = (await createTestResearcher(stack, "nightly-check", createdEmails)).supabase;
});
beforeEach(() => forgetResearchData(stack));
afterAll(async () => {
  await forgetResearchData(stack);
  await forgetTestEmails(stack, createdEmails);
});

const industrial = (n: number, name: string, ticker: string, sector: string | undefined = "Industrials") => ({
  cik: String(9_300_000_000 + n),
  name: `${name} (fictional)`,
  sector,
  tickers: [{ ticker, weight: 0.1 }],
});
const ANVIL = industrial(1, "Anvil Works", "ZANV");
const BELLOWS = industrial(2, "Bellows Pumps", "ZBLW");
const CRANE = industrial(3, "Crane Hollow", "ZCRH");
const DRIFT = industrial(4, "Driftwood Gears", "ZDRG", "Machinery & Parts");

const fact = async (cik: string, key: string) =>
  (await companyFacts(researcher, cik))?.facts.find((f) => f.key === key);

describe("Nightly Check", () => {
  it("saves a snapshot of each current member's price, metrics and ratings, asking by its primary ticker", async () => {
    const marketData = fakeMarketData({
      ZHLB: {
        quote: { price: 41.5, previousClose: 40 },
        metrics: { forwardPe: 18.2, peg: 1.4, grossMargin: 56.1, marketCap: 120_000 },
        ratings: [{ period: "2026-11-01", strongBuy: 4, buy: 6, hold: 3, sell: 1, strongSell: 0 }],
      },
    });

    await runTestNight(stack, "2026-11-02", { companies: [HARBOR_LANE], marketData });

    expect(marketData.quoted).toEqual(["ZHLB"]);
    const facts = await companyFacts(researcher, HARBOR_LANE.cik);
    expect(facts).toMatchObject({
      asOf: "2026-11-02",
      price: 41.5,
      previousClose: 40,
      ratings: [{ period: "2026-11-01", strongBuy: 4, buy: 6, hold: 3, sell: 1, strongSell: 0 }],
    });
    expect(facts?.facts.map((f) => [f.label, f.value])).toEqual([
      ["Forward P/E", 18.2],
      ["PEG", 1.4],
      ["Gross margin", 56.1],
      ["Operating margin", null],
      ["Revenue growth", null],
      ["Debt to equity", null],
    ]);
  });

  it("checks current members only; a former member keeps its last snapshot", async () => {
    const marketData = fakeMarketData({ ZQLF: { quote: { price: 12, previousClose: 12 } } });
    await runTestNight(stack, "2026-11-02", { companies: [HARBOR_LANE, QUILLFEATHER], marketData });
    marketData.quoted.length = 0;

    await runTestNight(stack, "2026-11-03", { companies: [HARBOR_LANE], marketData });

    expect(marketData.quoted).toEqual(["ZHLB"]);
    expect((await companyFacts(researcher, QUILLFEATHER.cik))?.asOf).toBe("2026-11-02");
    expect((await companyFacts(researcher, HARBOR_LANE.cik))?.asOf).toBe("2026-11-03");
  });

  it("shows no facts for a Company that has never been checked", async () => {
    expect(await companyFacts(researcher, HARBOR_LANE.cik)).toBeNull();
  });

  it("fails the run with a clear error when the market data provider can't be read", async () => {
    await expect(
      runTestNight(stack, "2026-11-02", {
        companies: [HARBOR_LANE],
        marketData: unreadableMarketData("Finnhub quote: HTTP 500"),
      }),
    ).rejects.toThrow("Finnhub quote: HTTP 500");

    expect((await recentRuns(researcher))[0]).toMatchObject({ outcome: "failed", error: "Finnhub quote: HTTP 500" });
  });

  it("still checks the existing members when the membership update is refused", async () => {
    const members = fictionalCompanies(12);
    await runTestNight(stack, "2026-11-02", { companies: members });
    const marketData = fakeMarketData();

    await runTestNight(stack, "2026-11-03", { companies: [], marketData });

    expect((await recentRuns(researcher))[0]).toMatchObject({ outcome: "succeeded", membershipUpdate: "refused" });
    expect(marketData.quoted).toHaveLength(12);
  });
});

describe("Sector Medians", () => {
  it("are the middle figure across current members in the Sector, leaving out missing figures", async () => {
    const marketData = fakeMarketData({
      ZANV: { metrics: { forwardPe: 10, peg: 1 } },
      ZBLW: { metrics: { forwardPe: 30, peg: 2 } },
      ZCRH: { metrics: { forwardPe: null, peg: 6 } },
      ZDRG: { metrics: { forwardPe: 500, peg: 50 } },
    });

    await runTestNight(stack, "2026-11-02", { companies: [ANVIL, BELLOWS, CRANE, DRIFT], marketData });

    // Two figures: the median is their average. Crane Hollow has none, so it isn't counted as zero.
    expect(await fact(ANVIL.cik, "forwardPe")).toMatchObject({ value: 10, sectorMedian: 20 });
    // Three figures: the middle one.
    expect(await fact(CRANE.cik, "peg")).toMatchObject({ value: 6, sectorMedian: 2 });
    expect(await fact(CRANE.cik, "forwardPe")).toMatchObject({ value: null, sectorMedian: 20 });
    // A Company whose Sector is "not found" has no median and is left out of every other one.
    expect(await fact(DRIFT.cik, "forwardPe")).toMatchObject({ value: 500, sectorMedian: null });
    // No figures at all: no median.
    expect(await fact(ANVIL.cik, "grossMargin")).toMatchObject({ value: null, sectorMedian: null });
  });

  it("leave out former members", async () => {
    const figures: Record<string, FakeTicker> = {
      ZANV: { metrics: { forwardPe: 10 } },
      ZBLW: { metrics: { forwardPe: 30 } },
      ZCRH: { metrics: { forwardPe: 90 } },
    };
    await runTestNight(stack, "2026-11-02", { companies: [ANVIL, BELLOWS, CRANE], marketData: fakeMarketData(figures) });

    await runTestNight(stack, "2026-11-03", { companies: [ANVIL, BELLOWS], marketData: fakeMarketData(figures) });

    expect(await fact(ANVIL.cik, "forwardPe")).toMatchObject({ sectorMedian: 20 });
  });
});

describe("The first run's Research List", () => {
  const byMarketCap = (companies: FictionalCompany[], cap: (i: number) => number | null) =>
    fakeMarketData(
      Object.fromEntries(companies.map((c, i) => [c.tickers[0].ticker, { metrics: { marketCap: cap(i) } }])),
    );

  it("starts with the 100 largest current members by market cap", async () => {
    const companies = fictionalCompanies(104);
    // Company i has market cap i + 1, except the largest-numbered one, which has none.
    await runTestNight(stack, "2026-11-02", {
      companies,
      marketData: byMarketCap(companies, (i) => (i === 103 ? null : i + 1)),
    });

    const onList = await listCompanies(researcher, { membership: "all", researchList: true });
    expect(onList).toHaveLength(100);
    const names = new Set(onList.map((c) => c.name));
    expect(names.has("Fictional Company 1")).toBe(false);
    expect(names.has("Fictional Company 2")).toBe(false);
    expect(names.has("Fictional Company 3")).toBe(false);
    expect(names.has("Fictional Company 4")).toBe(true);
    expect(names.has("Fictional Company 104")).toBe(false);
  });

  it("is never changed by later runs", async () => {
    const companies = fictionalCompanies(3);
    await runTestNight(stack, "2026-11-02", {
      companies: companies.slice(0, 2),
      marketData: byMarketCap(companies, (i) => i + 1),
    });

    await runTestNight(stack, "2026-11-03", { companies, marketData: byMarketCap(companies, (i) => 10 - i) });

    const onList = await listCompanies(researcher, { membership: "all", researchList: true });
    expect(onList.map((c) => c.name)).toEqual(["Fictional Company 1", "Fictional Company 2"]);
  });

  it("waits for a run that finds market caps, so a night without them doesn't leave it empty for good", async () => {
    const companies = fictionalCompanies(3);
    await runTestNight(stack, "2026-11-02", { companies, marketData: byMarketCap(companies, () => null) });
    expect(await listCompanies(researcher, { membership: "all", researchList: true })).toEqual([]);

    await runTestNight(stack, "2026-11-03", { companies, marketData: byMarketCap(companies, (i) => i + 1) });

    expect(await listCompanies(researcher, { membership: "all", researchList: true })).toHaveLength(3);
  });
});
