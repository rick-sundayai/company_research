import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { briefHistory, heldBackBriefs } from "../../src/lib/briefs";
import { listCompanies } from "../../src/lib/companies";
import { latestDigest } from "../../src/lib/digest";
import { stanceHistory } from "../../src/lib/stances";
import { DEMO_COMPANIES, seedDemo } from "../../src/demo/seed";
import {
  adminClient,
  createTestResearcher,
  forgetResearchData,
  forgetTestEmails,
  readLocalSupabase,
  withDb,
} from "../support/local-supabase";

const stack = readLocalSupabase();
const createdEmails: string[] = [];
let researcher: SupabaseClient;

beforeAll(async () => {
  researcher = (await createTestResearcher(stack, "demo", createdEmails)).supabase;
});
beforeEach(() => forgetResearchData(stack));
afterAll(async () => {
  await forgetResearchData(stack);
  await forgetTestEmails(stack, createdEmails);
});

describe("The demo seed", () => {
  it("contains only fictional Companies with invented names and tickers", () => {
    for (const company of DEMO_COMPANIES) {
      expect(company.name).toMatch(/\(fictional\)$/);
      // Invented tickers all start with ZQ, a prefix no listed US company uses.
      for (const { ticker } of company.tickers) expect(ticker).toMatch(/^ZQ[A-Z]{2}$/);
      expect(company.cik).toMatch(/^99\d{8}$/);
    }
  });

  it("fills an empty database with Briefs, a held-back Brief, Filing summaries, Stances, the Research List and a Digest", async () => {
    // Today, as the seed script runs it: the nights are in the past and the database dates its own rows now.
    const today = new Date().toISOString().slice(0, 10);
    await seedDemo(adminClient(stack), { today });

    const companies = await listCompanies(researcher, { membership: "all" });
    expect(companies.length).toBe(DEMO_COMPANIES.length);
    expect(companies.some((c) => c.membership === "former")).toBe(true);
    expect(companies.filter((c) => c.onResearchList).length).toBeGreaterThan(3);
    expect(companies.filter((c) => c.membership === "current" && !c.onResearchList).length).toBe(3);

    const allBriefs = (await Promise.all(companies.map((c) => briefHistory(researcher, c.cik)))).flat();
    expect(allBriefs.length).toBeGreaterThan(8);
    expect(allBriefs.some((b) => b.facts.sources.some((s) => s.kind === "filing"))).toBe(true);
    const held = (await Promise.all(companies.map((c) => heldBackBriefs(researcher, c.cik)))).flat();
    expect(held.length).toBeGreaterThan(0);

    const stances = (await Promise.all(companies.map((c) => stanceHistory(researcher, c.cik)))).flat();
    expect(stances.length).toBeGreaterThan(3);

    const digest = await latestDigest(researcher);
    expect(digest.run?.runDate).toBe(today);
    expect(digest.onList.map((g) => g.trigger)).toContain("requested");
    expect(digest.offList.map((c) => c.triggers[0].kind).sort()).toEqual(["analyst_shift", "price_move"]);
  });

  it("refuses a database that already has Companies", async () => {
    await withDb(stack, (db) =>
      db.query(
        `insert into public.companies (cik, name, sector, is_current_member, first_seen_on)
         values ('9200000099', 'Existing (fictional)', 'Energy', true, '2026-11-01')`,
      ),
    );

    await expect(seedDemo(adminClient(stack), { today: "2026-11-12" })).rejects.toThrow(
      "The demo seed only fills an empty database",
    );
  });
});
