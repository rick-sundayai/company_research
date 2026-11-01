import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { latestDigest, type Digest } from "../../src/lib/digest";
import type { EarningsReport, RatingCounts } from "../../src/night/market-data";
import type { FictionalCompany } from "../support/fake-constituent-source";
import { fakeMarketData, type FakeTicker } from "../support/fake-market-data";
import {
  createTestResearcher,
  forgetResearchData,
  forgetTestEmails,
  readLocalSupabase,
  withDb,
} from "../support/local-supabase";
import { runTestNight } from "../support/nights";

const stack = readLocalSupabase();
const createdEmails: string[] = [];
let researcher: SupabaseClient;

beforeAll(async () => {
  researcher = (await createTestResearcher(stack, "triggers", createdEmails)).supabase;
});
beforeEach(() => forgetResearchData(stack));
afterAll(async () => {
  await forgetResearchData(stack);
  await forgetTestEmails(stack, createdEmails);
});

const company = (n: number, name: string, ticker: string): FictionalCompany => ({
  cik: String(9_400_000_000 + n),
  name: `${name} (fictional)`,
  sector: "Utilities",
  tickers: [{ ticker, weight: 0.1 }],
});
const ORCHARD = company(1, "Orchard Grid", "ZORG");
const PEBBLE = company(2, "Pebble Water", "ZPBW");
const COMPANIES = [ORCHARD, PEBBLE];

async function putOnList(cik: string) {
  await withDb(stack, (db) =>
    db.query("insert into public.research_list_changes (cik, change, reason) values ($1, 'added', 'by_hand')", [cik]),
  );
}

function night(date: string, tickers: Record<string, FakeTicker>, earnings: EarningsReport[] = []) {
  return runTestNight(stack, date, { companies: COMPANIES, marketData: fakeMarketData(tickers, earnings) });
}

/**
 * Every Trigger in the latest Digest as "Company: kind", on the list and off it. No Brief yet and
 * routine are left out here; the Brief tests cover them.
 */
function fired(digest: Digest): string[] {
  return [
    ...digest.onList
      .filter((group) => group.trigger !== "no_brief_yet" && group.trigger !== "routine")
      .flatMap((group) => group.companies.map((c) => `${c.name}: ${group.trigger}`)),
    ...digest.offList.flatMap((c) => c.triggers.map((t) => `${c.name} (off the list): ${t.kind}`)),
  ];
}
const digestNow = async () => fired(await latestDigest(researcher));

const ratings = (period: string, buyers: number, total: number): RatingCounts => ({
  period,
  strongBuy: 0,
  buy: buyers,
  hold: total - buyers,
  sell: 0,
  strongSell: 0,
});

describe("Earnings reported", () => {
  it("fires for a Company on the Research List once its result is reported since the last run", async () => {
    await night("2026-11-02", {});
    await putOnList(ORCHARD.cik);

    await night("2026-11-04", {}, [
      { ticker: "ZORG", date: "2026-11-03", epsActual: 1.1, epsEstimate: 1 },
      { ticker: "ZPBW", date: "2026-11-04", epsActual: null, epsEstimate: 0.4 },
    ]);
    expect(await digestNow()).toEqual(["Orchard Grid (fictional): earnings_reported"]);

    // The same report the next night is not new.
    await night("2026-11-05", {}, [{ ticker: "ZORG", date: "2026-11-03", epsActual: 1.1, epsEstimate: 1 }]);
    expect(await digestNow()).toEqual([]);
  });

  it("is never shown for a Company off the Research List", async () => {
    await night("2026-11-02", {});
    await night("2026-11-03", {}, [{ ticker: "ZPBW", date: "2026-11-03", epsActual: 0.5, epsEstimate: 0.4 }]);

    expect(await digestNow()).toEqual([]);
  });
});

describe("Price move off the Research List", () => {
  it("fires on a change of 10% or more either way in a single day", async () => {
    await night("2026-11-02", {
      ZORG: { quote: { price: 110, previousClose: 100 } },
      ZPBW: { quote: { price: 90.1, previousClose: 100 } },
    });
    expect(await digestNow()).toEqual(["Orchard Grid (fictional) (off the list): price_move"]);

    await night("2026-11-03", { ZPBW: { quote: { price: 45, previousClose: 50 } } });
    expect(await digestNow()).toEqual(["Pebble Water (fictional) (off the list): price_move"]);
  });

  it("says how far and which way it moved", async () => {
    await night("2026-11-02", { ZORG: { quote: { price: 88, previousClose: 100 } } });

    const [orchard] = (await latestDigest(researcher)).offList;
    expect(orchard.triggers).toEqual([{ kind: "price_move", detail: { from: 100, to: 88, change: -0.12 } }]);
  });
});

describe("Analyst shift", () => {
  it("fires when the buy share moves 10 points or more against the previous month's", async () => {
    await night("2026-11-02", {
      ZORG: { ratings: [ratings("2026-11-01", 5, 10), ratings("2026-10-01", 4, 10)] },
      ZPBW: { ratings: [ratings("2026-11-01", 5, 10), ratings("2026-10-01", 6, 12)] },
    });

    // Orchard: 40% → 50%. Pebble: 50% → 50%.
    expect(await digestNow()).toEqual(["Orchard Grid (fictional) (off the list): analyst_shift"]);
    const [orchard] = (await latestDigest(researcher)).offList;
    expect(orchard.triggers[0].detail).toEqual({ from: 0.4, to: 0.5, analysts: 10 });
  });

  it("needs at least 5 analysts", async () => {
    await night("2026-11-02", { ZORG: { ratings: [ratings("2026-11-01", 4, 4), ratings("2026-10-01", 1, 4)] } });

    expect(await digestNow()).toEqual([]);
  });

  it("fires at most once in a calendar month, and again after the month turns", async () => {
    const shifted = { ZORG: { ratings: [ratings("2026-10-01", 8, 10), ratings("2026-09-01", 4, 10)] } };
    await night("2026-10-28", shifted);
    expect(await digestNow()).toEqual(["Orchard Grid (fictional) (off the list): analyst_shift"]);

    // Still shifted, and shifting further, later the same month: no second Trigger.
    await night("2026-10-29", shifted);
    expect(await digestNow()).toEqual([]);
    await night("2026-10-31", { ZORG: { ratings: [ratings("2026-10-01", 9, 10), ratings("2026-09-01", 4, 10)] } });
    expect(await digestNow()).toEqual([]);

    // A new month, compared with October's share: it can fire again.
    await night("2026-11-01", { ZORG: { ratings: [ratings("2026-11-01", 6, 10), ratings("2026-10-01", 9, 10)] } });
    expect(await digestNow()).toEqual(["Orchard Grid (fictional) (off the list): analyst_shift"]);
  });

  it("needs the previous month's counts to compare with", async () => {
    await night("2026-11-02", { ZORG: { ratings: [ratings("2026-11-01", 9, 10), ratings("2026-09-01", 1, 10)] } });

    expect(await digestNow()).toEqual([]);
  });

  it("is shown in the Research List part of the Digest for a Company on the list", async () => {
    await night("2026-11-02", {});
    await putOnList(PEBBLE.cik);

    await night("2026-11-03", { ZPBW: { ratings: [ratings("2026-11-01", 2, 10), ratings("2026-10-01", 7, 10)] } });

    expect(await digestNow()).toEqual(["Pebble Water (fictional): analyst_shift"]);
  });
});

describe("The Digest", () => {
  it("never fires a Trigger for news alone", async () => {
    await night("2026-11-02", {
      ZORG: {
        quote: { price: 100, previousClose: 100 },
        news: [{ headline: "Fictional headline", source: "Wire", url: "https://news.example.test", publishedAt: "2026-11-02T01:00:00Z" }],
      },
    });

    expect(await digestNow()).toEqual([]);
  });

  it("shows only the latest run: a quiet night after a busy one is empty", async () => {
    await night("2026-11-02", { ZORG: { quote: { price: 120, previousClose: 100 } } });
    await night("2026-11-03", { ZORG: { quote: { price: 120, previousClose: 120 } } });

    const digest = await latestDigest(researcher);
    expect(digest.run?.runDate).toBe("2026-11-03");
    expect(fired(digest)).toEqual([]);
  });

  it("puts Candidate and Watching Companies first within each Trigger", async () => {
    await night("2026-11-02", {});
    await putOnList(ORCHARD.cik);
    await putOnList(PEBBLE.cik);
    await withDb(stack, (db) =>
      db.query("insert into public.stance_entries (cik, stance, note) values ($1, 'Watching', 'Rates')", [PEBBLE.cik]),
    );

    await night("2026-11-04", {}, [
      { ticker: "ZORG", date: "2026-11-03", epsActual: 1, epsEstimate: 1 },
      { ticker: "ZPBW", date: "2026-11-03", epsActual: 1, epsEstimate: 1 },
    ]);

    expect(await digestNow()).toEqual([
      "Pebble Water (fictional): earnings_reported",
      "Orchard Grid (fictional): earnings_reported",
    ]);
  });
});
