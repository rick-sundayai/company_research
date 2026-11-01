import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { briefHistory, latestBrief, researchBudget } from "../../src/lib/briefs";
import { latestDigest } from "../../src/lib/digest";
import { recentRuns } from "../../src/lib/nightly-runs";
import type { AiWriter } from "../../src/night/ai-writer";
import type { FictionalCompany } from "../support/fake-constituent-source";
import { fakeAiWriter } from "../support/fake-ai-writer";
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
  researcher = (await createTestResearcher(stack, "briefs", createdEmails)).supabase;
});
beforeEach(() => forgetResearchData(stack));
afterAll(async () => {
  await forgetResearchData(stack);
  await forgetTestEmails(stack, createdEmails);
});

const company = (n: number, name: string, ticker: string): FictionalCompany => ({
  cik: String(9_600_000_000 + n),
  name: `${name} (fictional)`,
  sector: "Health Care",
  tickers: [{ ticker, weight: 0.1 }],
});
const TANSY = company(1, "Tansy Labs", "ZTSY");
const UMBER = company(2, "Umber Clinics", "ZUMB");
const VETCH = company(3, "Vetch Devices", "ZVTC");
const WOAD = company(4, "Woad Pharma", "ZWOD");
const COMPANIES = [TANSY, UMBER, VETCH, WOAD];

const putOnList = (...ciks: string[]) =>
  withDb(stack, async (db) => {
    for (const cik of ciks) {
      await db.query("insert into public.research_list_changes (cik, change, reason) values ($1, 'added', 'by_hand')", [cik]);
    }
  });
/** Sets a Stance; `setAt` lines it up with the test nights' clock (the database would date it now). */
const setStance = (cik: string, stance: string, note = "A note", setAt = "2026-11-02T12:00:00Z") =>
  withDb(stack, (db) =>
    db.query("insert into public.stance_entries (cik, stance, note, set_at) values ($1, $2, $3, $4)", [
      cik,
      stance,
      note,
      setAt,
    ]),
  );

const priced = (prices: Record<string, number>, extra: Record<string, FakeTicker> = {}) =>
  fakeMarketData(
    Object.fromEntries(
      Object.entries(prices).map(([ticker, price]) => [
        ticker,
        { quote: { price, previousClose: price }, ...extra[ticker] },
      ]),
    ),
  );

function night(date: string, prices: Record<string, number>, aiWriter: AiWriter = fakeAiWriter(), extra = {}) {
  return runTestNight(stack, date, { companies: COMPANIES, marketData: priced(prices, extra), aiWriter });
}

/** The night's Briefs as "Company: triggers". */
async function briefsOn(date: string): Promise<string[]> {
  const out: string[] = [];
  for (const c of COMPANIES) {
    for (const brief of await briefHistory(researcher, c.cik)) {
      if (brief.runDate === date) out.push(`${c.name}: ${brief.triggers.join(", ")}`);
    }
  }
  return out;
}

describe("Which Companies get a Brief", () => {
  it("writes one only for a current member on the Research List with a Trigger", async () => {
    await night("2026-11-02", {});
    await putOnList(TANSY.cik);

    // Woad, off the list, moves 20% in a day: named in the Digest, but no Brief.
    await runTestNight(stack, "2026-11-03", {
      companies: COMPANIES,
      marketData: fakeMarketData({ ZTSY: { quote: { price: 50, previousClose: 50 } }, ZWOD: { quote: { price: 12, previousClose: 10 } } }),
      aiWriter: fakeAiWriter(),
    });

    expect(await briefsOn("2026-11-03")).toEqual(["Tansy Labs (fictional): no_brief_yet"]);
    expect((await latestDigest(researcher)).offList.map((c) => c.name)).toEqual(["Woad Pharma (fictional)"]);
  });

  it("doesn't write one for a Company that left the index, even if it is still on the list", async () => {
    await night("2026-11-02", {});
    await putOnList(UMBER.cik);

    await runTestNight(stack, "2026-11-03", {
      companies: [TANSY, VETCH, WOAD],
      marketData: fakeMarketData(),
      aiWriter: fakeAiWriter(),
    });

    expect(await briefsOn("2026-11-03")).toEqual([]);
  });

  it("writes a routine Brief when the latest is 7 days old, and not before", async () => {
    await night("2026-11-02", {});
    await putOnList(TANSY.cik);
    await night("2026-11-03", { ZTSY: 50 });

    await night("2026-11-09", { ZTSY: 50 });
    expect(await briefsOn("2026-11-09")).toEqual([]);
    await night("2026-11-10", { ZTSY: 50 });
    expect(await briefsOn("2026-11-10")).toEqual(["Tansy Labs (fictional): routine"]);
  });
});

describe("Price move on the Research List", () => {
  it("is measured from the first Brief, and routine Briefs don't reset that baseline", async () => {
    await night("2026-11-02", {});
    await putOnList(TANSY.cik);
    await night("2026-11-03", { ZTSY: 100 }); // first Brief: the baseline is 100
    await night("2026-11-10", { ZTSY: 106 }); // routine Brief at 106 keeps the baseline at 100
    expect(await briefsOn("2026-11-10")).toEqual(["Tansy Labs (fictional): routine"]);

    await night("2026-11-11", { ZTSY: 110 }); // 10% from 100, though under 4% from 106
    expect(await briefsOn("2026-11-11")).toEqual(["Tansy Labs (fictional): price_move"]);

    // That Brief, caused by a price move, is the new baseline: 110 → 118 is under 10%.
    await night("2026-11-12", { ZTSY: 118 });
    expect(await briefsOn("2026-11-12")).toEqual([]);
    await night("2026-11-13", { ZTSY: 98 });
    expect(await briefsOn("2026-11-13")).toEqual(["Tansy Labs (fictional): price_move"]);
  });
});

describe("A Brief", () => {
  it("holds its facts beside their Sector Medians, what changed, the price since the Stance, news and a machine-written summary", async () => {
    await night("2026-11-02", {});
    await putOnList(TANSY.cik);
    await night("2026-11-03", { ZTSY: 40, ZUMB: 60 }, fakeAiWriter(), {
      ZTSY: { metrics: { forwardPe: 20, grossMargin: 61 } },
      ZUMB: { metrics: { forwardPe: 30 } },
    });
    await setStance(TANSY.cik, "Watching", "Pipeline looks thin", "2026-11-05T12:00:00Z");

    await night(
      "2026-11-10",
      { ZTSY: 42, ZUMB: 60 },
      fakeAiWriter(),
      {
        ZTSY: {
          metrics: { forwardPe: 22, grossMargin: 61 },
          news: [{ headline: "Tansy opens a lab", source: "Fictional Wire", url: "https://news.example.test/t", publishedAt: "2026-11-08T12:00:00Z" }],
        },
        ZUMB: { metrics: { forwardPe: 30 } },
      },
    );

    const brief = await latestBrief(researcher, TANSY.cik);
    expect(brief).toMatchObject({ runDate: "2026-11-10", triggers: ["routine"], price: 42, model: "fake-writer" });
    expect(brief?.facts.facts.find((f) => f.key === "forwardPe")).toMatchObject({ value: 22, sectorMedian: 26 });
    expect(brief?.facts.facts.find((f) => f.key === "peg")).toMatchObject({ value: null, sectorMedian: null });
    expect(brief?.facts.changes).toEqual([
      { label: "Price", from: 40, to: 42 },
      { label: "Forward P/E", from: 20, to: 22 },
    ]);
    expect(brief?.facts.sinceStance).toMatchObject({ stance: "Watching", priceThen: 40, change: 0.05 });
    expect(brief?.facts.news).toEqual([
      { id: "news-1", headline: "Tansy opens a lab", source: "Fictional Wire", url: "https://news.example.test/t", publishedAt: "2026-11-08T12:00:00Z" },
    ]);
    expect(brief?.summary).toContain("Bull case");
    expect(brief?.notice).toBe(
      "This summary is machine-written by fake-writer from the facts and sources in this Brief only. It may be wrong: check it against them.",
    );
  });

  it("can never be edited or deleted, even with direct database access", async () => {
    await night("2026-11-02", {});
    await putOnList(TANSY.cik);
    await night("2026-11-03", { ZTSY: 40 });

    await expect(withDb(stack, (db) => db.query("update public.briefs set summary = 'edited'"))).rejects.toThrow(
      "Briefs are never edited or removed",
    );
    await expect(withDb(stack, (db) => db.query("delete from public.briefs"))).rejects.toThrow(
      "Briefs are never edited or removed",
    );
    await expect(withDb(stack, (db) => db.query("truncate public.briefs cascade"))).rejects.toThrow(
      "Briefs are never edited or removed",
    );
  });
});

describe("The Research Budget", () => {
  const spend = (dollars: number, month: string) =>
    withDb(stack, (db) =>
      db.query(
        `insert into public.ai_calls (month, purpose, input_tokens, output_tokens, estimated_cost_usd, cost_usd)
         values ($1, 'brief', 0, 0, $2, $2)`,
        [month, dollars],
      ),
    );

  it("writes the most important Briefs first and defers what won't fit under $10 a month", async () => {
    await night("2026-11-02", {});
    await putOnList(TANSY.cik, UMBER.cik, VETCH.cik, WOAD.cik);
    await setStance(WOAD.cik, "Candidate");
    await spend(7.5, "2026-11-01");

    // Each Brief costs $1: three fit under the cap. Woad is a Candidate, Vetch reported earnings.
    const writer = fakeAiWriter({ cost: 1 });
    await runTestNight(stack, "2026-11-03", {
      companies: COMPANIES,
      marketData: fakeMarketData({}, [{ ticker: "ZVTC", date: "2026-11-03", epsActual: 1, epsEstimate: 1 }]),
      aiWriter: writer,
    });

    expect(writer.written.map((r) => r.companyName)).toEqual(["Woad Pharma (fictional)", "Vetch Devices (fictional)"]);
    expect(await researchBudget(researcher, "2026-11-03")).toEqual({ spent: 9.5, limit: 10, left: 0.5 });
    expect((await recentRuns(researcher))[0]).toMatchObject({ briefsWritten: 2, briefsDeferred: 2 });
  });

  it("starts each month afresh", async () => {
    await night("2026-10-30", {});
    await putOnList(TANSY.cik);
    await spend(10, "2026-10-01");

    await night("2026-10-31", { ZTSY: 40 }, fakeAiWriter({ cost: 1 }));
    expect(await briefsOn("2026-10-31")).toEqual([]);

    await night("2026-11-01", { ZTSY: 40 }, fakeAiWriter({ cost: 1 }));
    expect(await briefsOn("2026-11-01")).toEqual(["Tansy Labs (fictional): no_brief_yet"]);
    expect(await researchBudget(researcher, "2026-11-01")).toEqual({ spent: 1, limit: 10, left: 9 });
  });

  it("records each call's actual cost, not its estimate", async () => {
    await night("2026-11-02", {});
    await putOnList(TANSY.cik);

    await night("2026-11-03", { ZTSY: 40 }, fakeAiWriter({ cost: 0.02, actualCost: 0.0123 }));

    expect((await researchBudget(researcher, "2026-11-03")).spent).toBe(0.0123);
  });
});

describe("The Digest", () => {
  it("groups the night's Briefs by Trigger and flags Companies whose latest Brief is over 7 days old", async () => {
    await night("2026-11-02", {});
    await putOnList(TANSY.cik, UMBER.cik);
    await night("2026-11-03", { ZTSY: 40, ZUMB: 60 });

    // A full budget defers both routine Briefs on the 10th, and they go stale.
    await withDb(stack, (db) =>
      db.query(
        `insert into public.ai_calls (month, purpose, input_tokens, output_tokens, estimated_cost_usd, cost_usd)
         values ('2026-11-01', 'brief', 0, 0, 10, 10)`,
      ),
    );
    await night("2026-11-11", { ZTSY: 40, ZUMB: 60 });

    const digest = await latestDigest(researcher);
    expect(digest.onList).toEqual([
      expect.objectContaining({ trigger: "routine", companies: [expect.objectContaining({ brief: null }), expect.objectContaining({ brief: null })] }),
    ]);
    expect(digest.stale.map((c) => c.name)).toEqual(["Tansy Labs (fictional)", "Umber Clinics (fictional)"]);
    expect(digest.briefsDeferred).toBe(2);
  });
});
