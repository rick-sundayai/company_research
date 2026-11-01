import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { latestBrief, researchBudget } from "../../src/lib/briefs";
import { pendingRequest } from "../../src/lib/brief-requests";
import { listCompanies } from "../../src/lib/companies";
import { companyFacts } from "../../src/lib/facts";
import { recentRuns } from "../../src/lib/nightly-runs";
import { fictionalCompanies, type FictionalCompany } from "../support/fake-constituent-source";
import { fakeAiWriter } from "../support/fake-ai-writer";
import { fakeMarketData } from "../support/fake-market-data";
import {
  anonClient,
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
  researcher = (await createTestResearcher(stack, "requests", createdEmails)).supabase;
});
beforeEach(() => forgetResearchData(stack));
afterAll(async () => {
  await forgetResearchData(stack);
  await forgetTestEmails(stack, createdEmails);
});

const putOnList = (...ciks: string[]) =>
  withDb(stack, async (db) => {
    for (const cik of ciks) {
      await db.query("insert into public.research_list_changes (cik, change, reason) values ($1, 'added', 'by_hand')", [cik]);
    }
  });

/** Market caps: company i has i + 1 (in millions), so higher-numbered Companies are larger. */
const bySize = (companies: FictionalCompany[]) =>
  fakeMarketData(
    Object.fromEntries(companies.map((c, i) => [c.tickers[0].ticker, { metrics: { marketCap: i + 1 } }])),
  );

describe("Requested Briefs", () => {
  it("are recorded by the Researcher and written by the next run, ahead of everything else, naming the Trigger", async () => {
    const companies = fictionalCompanies(3);
    await runTestNight(stack, "2026-11-02", { companies, marketData: bySize(companies) });
    // The first run put all three on the list and wrote their first Briefs.
    const [small] = companies;

    const { error } = await researcher.from("brief_requests").insert({ cik: small.cik });
    expect(error).toBeNull();
    expect(await pendingRequest(researcher, small.cik)).toMatchObject({ requestedAt: expect.any(String) });

    // A day later nothing else is due, and the budget has room for just one Brief: the requested one.
    await withDb(stack, (db) =>
      db.query(
        `insert into public.ai_calls (month, purpose, input_tokens, output_tokens, estimated_cost_usd, cost_usd)
         values ('2026-11-01', 'brief', 0, 0, 8.97, 8.97)`,
      ),
    );
    const writer = fakeAiWriter({ cost: 1 });
    await runTestNight(stack, "2026-11-03", { companies, marketData: bySize(companies), aiWriter: writer });

    expect(writer.written.map((r) => r.companyName)).toEqual(["Fictional Company 1"]);
    expect((await latestBrief(researcher, small.cik))?.triggers).toEqual(["requested"]);
    expect(await pendingRequest(researcher, small.cik)).toBeNull();
  });

  it("stays pending while the Research Budget defers it", async () => {
    const [company] = fictionalCompanies(1);
    await runTestNight(stack, "2026-11-02", { companies: [company] });
    await putOnList(company.cik);
    await researcher.from("brief_requests").insert({ cik: company.cik });
    await withDb(stack, (db) =>
      db.query(
        `insert into public.ai_calls (month, purpose, input_tokens, output_tokens, estimated_cost_usd, cost_usd)
         values ('2026-11-01', 'brief', 0, 0, 10, 10)`,
      ),
    );

    await runTestNight(stack, "2026-11-03", { companies: [company] });

    expect(await pendingRequest(researcher, company.cik)).not.toBeNull();
  });

  it("can't be read by anyone who isn't signed in, nor marked done by the Researcher", async () => {
    const [company] = fictionalCompanies(1);
    await runTestNight(stack, "2026-11-02", { companies: [company] });
    await researcher.from("brief_requests").insert({ cik: company.cik });

    const asAnon = await anonClient(stack).from("brief_requests").select("cik");
    await researcher.from("brief_requests").update({ done_run_id: 1 }).eq("cik", company.cik);

    expect(asAnon.data ?? []).toEqual([]);
    expect(await pendingRequest(researcher, company.cik)).not.toBeNull();
  });
});

describe("The first run", () => {
  it("checks every current member from the first night, and spreads first Briefs across nights, largest first", async () => {
    const companies = fictionalCompanies(30);
    await runTestNight(stack, "2026-11-02", { companies, marketData: bySize(companies) });

    expect(await listCompanies(researcher, { membership: "current", researchList: true })).toHaveLength(30);
    expect(await companyFacts(researcher, companies[0].cik)).not.toBeNull();
    // 25 first Briefs a night: the 25 largest tonight, the other 5 tomorrow.
    expect((await recentRuns(researcher))[0]).toMatchObject({ briefsWritten: 25, briefsDeferred: 5 });
    expect(await latestBrief(researcher, companies[29].cik)).not.toBeNull();
    expect(await latestBrief(researcher, companies[4].cik)).toBeNull();

    await runTestNight(stack, "2026-11-03", { companies, marketData: bySize(companies) });

    expect((await recentRuns(researcher))[0]).toMatchObject({ briefsWritten: 5, briefsDeferred: 0 });
    expect(await latestBrief(researcher, companies[0].cik)).not.toBeNull();
  });

  it("stays under the monthly cap as it spreads", async () => {
    const companies = fictionalCompanies(30);
    // $0.40 a Brief: 25 would cost $10.00, so the cap allows 25 on the first night and none after.
    await runTestNight(stack, "2026-11-02", { companies, marketData: bySize(companies), aiWriter: fakeAiWriter({ cost: 0.4 }) });
    await runTestNight(stack, "2026-11-03", { companies, marketData: bySize(companies), aiWriter: fakeAiWriter({ cost: 0.4 }) });

    expect((await researchBudget(researcher, "2026-11-03")).spent).toBe(10);
    expect((await recentRuns(researcher))[0]).toMatchObject({ briefsWritten: 0, briefsDeferred: 5 });
  });
});
