import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { briefHistory, heldBackBriefs, latestBrief, researchBudget } from "../../src/lib/briefs";
import { latestDigest } from "../../src/lib/digest";
import { recentRuns } from "../../src/lib/nightly-runs";
import type { BriefRequest } from "../../src/night/ai-writer";
import type { EarningsReport } from "../../src/night/market-data";
import type { FictionalCompany } from "../support/fake-constituent-source";
import { fakeAiWriter } from "../support/fake-ai-writer";
import { fakeMarketData } from "../support/fake-market-data";
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
  researcher = (await createTestResearcher(stack, "source-check", createdEmails)).supabase;
});
beforeEach(() => forgetResearchData(stack));
afterAll(async () => {
  await forgetResearchData(stack);
  await forgetTestEmails(stack, createdEmails);
});

const ALDER: FictionalCompany = {
  cik: "9800000001",
  name: "Alder Textiles (fictional)",
  sector: "Consumer Discretionary",
  tickers: [{ ticker: "ZALD", weight: 0.2 }],
};

const marketData = (price: number, earnings: EarningsReport[] = []) =>
  fakeMarketData(
    {
      ZALD: {
        quote: { price, previousClose: price },
        metrics: { forwardPe: 14.2, grossMargin: 38.5 },
        news: [{ headline: "Alder opens a mill", source: "Fictional Wire", url: "https://news.example.test/a", publishedAt: "2026-11-01T08:00:00Z" }],
      },
    },
    earnings,
  );

/** A night where the writer's summary is `summary`. */
function night(date: string, summary: (r: BriefRequest) => string, price = 50) {
  return runTestNight(stack, date, {
    companies: [ALDER],
    marketData: marketData(price),
    aiWriter: fakeAiWriter({ summary }),
  });
}

const honest = (r: BriefRequest) =>
  `Bull case: a forward P/E of 14.2 against the Sector [facts] and a new mill [news-1].\nBear case: gross margin of 38.5% [facts].\nOpen questions: whether the $50.00 price holds [facts].`;

async function onList() {
  await night("2026-11-02", honest);
  await withDb(stack, (db) =>
    db.query("insert into public.research_list_changes (cik, change, reason) values ($1, 'added', 'by_hand')", [ALDER.cik]),
  );
}

describe("The Source Check", () => {
  it("passes a Brief whose every number and cited source is in the Brief", async () => {
    await onList();

    await night("2026-11-03", honest);

    expect((await latestBrief(researcher, ALDER.cik))?.runDate).toBe("2026-11-03");
    expect(await heldBackBriefs(researcher, ALDER.cik)).toEqual([]);
  });

  it("holds back a Brief with a number that matches no fact, and the Company keeps its previous Brief", async () => {
    await onList();
    await night("2026-11-03", honest);

    await night("2026-11-10", () => "Bull case: gross margin of 61% [facts].");

    expect((await latestBrief(researcher, ALDER.cik))?.runDate).toBe("2026-11-03");
    const [held] = await heldBackBriefs(researcher, ALDER.cik);
    expect(held.runDate).toBe("2026-11-10");
    expect(held.reasons).toEqual(["The number 61% matches no fact in the Brief."]);
    expect((await recentRuns(researcher))[0]).toMatchObject({ briefsWritten: 0, briefsHeldBack: 1 });
  });

  it("holds back a Brief that cites a source the Brief doesn't have", async () => {
    await onList();

    await night("2026-11-03", () => "Bear case: a lawsuit [news-4] and a recall [filing-0001].");

    expect(await latestBrief(researcher, ALDER.cik)).toBeNull();
    expect((await heldBackBriefs(researcher, ALDER.cik))[0].reasons).toEqual([
      "Cites [news-4], which is not a source in the Brief.",
      "Cites [filing-0001], which is not a source in the Brief.",
    ]);
  });

  it("holds back a Brief that makes a recommendation or gives a rating", async () => {
    await onList();

    await night("2026-11-03", () => "Bull case: we recommend buying [facts].\nBear case: none, it should outperform [facts].");

    expect((await heldBackBriefs(researcher, ALDER.cik))[0].reasons).toEqual([
      'It reads as a recommendation or rating ("recommend").',
      'It reads as a recommendation or rating ("outperform").',
    ]);
  });

  it("retries a held-back Brief the next night with its Triggers, counting against the Research Budget", async () => {
    await onList();
    await night("2026-11-03", honest);
    const earnings = [{ ticker: "ZALD", date: "2026-11-04", epsActual: 0.3, epsEstimate: 0.25 }];
    await runTestNight(stack, "2026-11-04", {
      companies: [ALDER],
      marketData: fakeMarketData({ ZALD: { quote: { price: 50, previousClose: 50 } } }, earnings),
      aiWriter: fakeAiWriter({ summary: () => "Bull case: 99 reasons [facts]." }),
    });

    // No new Trigger tonight: only the retry.
    await night("2026-11-05", honest);

    const retried = await latestBrief(researcher, ALDER.cik);
    expect(retried).toMatchObject({ runDate: "2026-11-05", triggers: ["earnings_reported"] });
    // It carries what the original Trigger found.
    expect(retried?.facts.triggers[0].detail).toMatchObject({ date: "2026-11-04", epsActual: 0.3, retry: true });
    expect((await researchBudget(researcher, "2026-11-05")).spent).toBe(0.03);
  });

  it("stops retrying after two failures in a row and flags the Company, until a new event", async () => {
    await onList();
    await night("2026-11-03", () => "Bull case: 99 reasons [facts].");
    await night("2026-11-04", () => "Bull case: 98 reasons [facts].");

    const writer = fakeAiWriter({ summary: honest });
    await runTestNight(stack, "2026-11-05", { companies: [ALDER], marketData: marketData(50), aiWriter: writer });

    expect(writer.written).toEqual([]);
    expect(await briefHistory(researcher, ALDER.cik)).toEqual([]);
    const digest = await latestDigest(researcher);
    expect(digest.flagged.map((c) => c.name)).toEqual(["Alder Textiles (fictional)"]);

    // A new event still gets a fresh attempt.
    await runTestNight(stack, "2026-11-06", {
      companies: [ALDER],
      marketData: marketData(50, [{ ticker: "ZALD", date: "2026-11-06", epsActual: 0.3, epsEstimate: 0.25 }]),
      aiWriter: fakeAiWriter({ summary: honest }),
    });
    expect((await latestBrief(researcher, ALDER.cik))?.triggers).toEqual(["earnings_reported"]);
    expect((await latestDigest(researcher)).flagged).toEqual([]);
  });

  it("keeps a held-back Brief out of the Digest and counts it", async () => {
    await onList();

    await night("2026-11-03", () => "Bull case: 99 reasons [facts].");

    const digest = await latestDigest(researcher);
    expect(digest.onList[0].companies[0]).toMatchObject({ name: "Alder Textiles (fictional)", brief: null, heldBack: true });
    expect(digest.briefsHeldBack).toBe(1);
  });
});
