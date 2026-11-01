import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { latestBrief, researchBudget } from "../../src/lib/briefs";
import { latestDigest } from "../../src/lib/digest";
import type { Filing } from "../../src/night/filings-source";
import type { FictionalCompany } from "../support/fake-constituent-source";
import { fakeAiWriter, type FakeAiWriter } from "../support/fake-ai-writer";
import { fakeFilingsSource, fictionalFiling, type FakeFilingsSource } from "../support/fake-filings-source";
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
  researcher = (await createTestResearcher(stack, "filings", createdEmails)).supabase;
});
beforeEach(() => forgetResearchData(stack));
afterAll(async () => {
  await forgetResearchData(stack);
  await forgetTestEmails(stack, createdEmails);
});

const BIRCH: FictionalCompany = {
  cik: "9800000011",
  name: "Birch Robotics (fictional)",
  sector: "Information Technology",
  tickers: [{ ticker: "ZBRC", weight: 0.3 }],
};
const CEDAR: FictionalCompany = {
  cik: "9800000012",
  name: "Cedar Software (fictional)",
  sector: "Information Technology",
  tickers: [{ ticker: "ZCDR", weight: 0.3 }],
};

const OLD_10Q = fictionalFiling(BIRCH.cik, 1, "10-Q", "2026-05-01");
const LATEST_10K = fictionalFiling(BIRCH.cik, 2, "10-K", "2026-08-01");
const LATEST_10Q = fictionalFiling(BIRCH.cik, 3, "10-Q", "2026-10-15");
const NEW_10Q = fictionalFiling(BIRCH.cik, 4, "10-Q", "2026-11-04");

function night(date: string, filings: Record<string, Filing[]>, writer: FakeAiWriter = fakeAiWriter()) {
  const source = fakeFilingsSource(filings);
  return runTestNight(stack, date, { companies: [BIRCH, CEDAR], filings: source, aiWriter: writer }).then(() => source);
}

async function putBirchOnList() {
  await night("2026-11-02", {});
  await withDb(stack, (db) =>
    db.query("insert into public.research_list_changes (cik, change, reason) values ($1, 'added', 'by_hand')", [BIRCH.cik]),
  );
}

const sourceIds = async () => (await latestBrief(researcher, BIRCH.cik))?.facts.sources.map((s) => s.id);

describe("Filings", () => {
  it("are read only for Companies on the Research List", async () => {
    await putBirchOnList();

    const source: FakeFilingsSource = await night("2026-11-03", {});

    expect(source.listed).toEqual([BIRCH.cik]);
  });

  it("summarises the latest 10-K and 10-Q when a Company joins the list, without a new-Filing Trigger", async () => {
    await putBirchOnList();
    const writer = fakeAiWriter();

    await night("2026-11-03", { [BIRCH.cik]: [LATEST_10Q, LATEST_10K, OLD_10Q] }, writer);

    expect(writer.summarised.map((f) => `${f.form} ${f.filedOn}`)).toEqual(["10-K 2026-08-01", "10-Q 2026-10-15"]);
    const brief = await latestBrief(researcher, BIRCH.cik);
    expect(brief?.triggers).toEqual(["no_brief_yet"]);
    expect(await sourceIds()).toEqual(["facts", `filing-${LATEST_10K.accession}`, `filing-${LATEST_10Q.accession}`]);
    expect(brief?.facts.factsText).toContain("The 10-Q filed 2026-10-15 says: Fictional 10-Q text");
  });

  it("fires the new-Filing Trigger for a Filing not seen before, and summarises it once, against the budget", async () => {
    await putBirchOnList();
    await night("2026-11-03", { [BIRCH.cik]: [LATEST_10Q, LATEST_10K] });
    const writer = fakeAiWriter();

    await night("2026-11-05", { [BIRCH.cik]: [NEW_10Q, LATEST_10Q, LATEST_10K] }, writer);

    expect(writer.summarised.map((f) => f.filedOn)).toEqual(["2026-11-04"]);
    expect((await latestDigest(researcher)).onList.map((g) => g.trigger)).toEqual(["new_filing"]);
    expect((await latestBrief(researcher, BIRCH.cik))?.triggers).toEqual(["new_filing"]);
    expect(await sourceIds()).toEqual(["facts", `filing-${LATEST_10K.accession}`, `filing-${NEW_10Q.accession}`]);
    // Two Filing summaries and a Brief on the 3rd, one summary and a Brief on the 5th, a cent each.
    expect((await researchBudget(researcher, "2026-11-05")).spent).toBe(0.05);
  });

  it("reuses each summary in later Briefs without another AI call", async () => {
    await putBirchOnList();
    await night("2026-11-03", { [BIRCH.cik]: [LATEST_10Q, LATEST_10K] });
    const writer = fakeAiWriter();

    await night("2026-11-10", { [BIRCH.cik]: [LATEST_10Q, LATEST_10K] }, writer);

    expect((await latestBrief(researcher, BIRCH.cik))?.triggers).toEqual(["routine"]);
    expect(writer.summarised).toEqual([]);
    expect(await sourceIds()).toContain(`filing-${LATEST_10Q.accession}`);
  });
});
