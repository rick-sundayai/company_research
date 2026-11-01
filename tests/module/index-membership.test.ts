import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listCompanies, type CompanyRow } from "../../src/lib/companies";
import { recentRuns } from "../../src/lib/nightly-runs";
import type { ConstituentSource } from "../../src/night/constituent-source";
import {
  constituentList,
  fakeConstituentSource,
  fictionalCompanies,
  HARBOR_LANE,
  QUILLFEATHER,
  unreadableConstituentSource,
  type FictionalCompany,
} from "../support/fake-constituent-source";
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
  researcher = (await createTestResearcher(stack, "membership", createdEmails)).supabase;
});
beforeEach(() => forgetResearchData(stack));
afterAll(async () => {
  await forgetResearchData(stack);
  await forgetTestEmails(stack, createdEmails);
});

function night(date: string, source: ConstituentSource) {
  return runTestNight(stack, date, { constituents: source });
}

function nightWith(date: string, companies: FictionalCompany[]) {
  return night(date, fakeConstituentSource(constituentList(companies)));
}

async function company(cik: string): Promise<CompanyRow | undefined> {
  return (await listCompanies(researcher, { membership: "all" })).find((c) => c.cik === cik);
}

describe("Index Membership", () => {
  it("groups share classes into one Company, with the largest SPY weight as its primary ticker", async () => {
    await nightWith("2026-11-02", [HARBOR_LANE, QUILLFEATHER]);

    expect(await company(HARBOR_LANE.cik)).toEqual({
      cik: HARBOR_LANE.cik,
      name: "Harbor Lane Holdings (fictional)",
      sector: "Communication Services",
      primaryTicker: "ZHLB",
      otherTickers: ["ZHLA"],
      membership: "current",
      history: [{ change: "joined", seenOn: "2026-11-02" }],
      stance: "Unreviewed",
      onResearchList: false,
    });
    expect((await company(QUILLFEATHER.cik))?.primaryTicker).toBe("ZQLF");
  });

  it("doesn't add a Company that joins the index to the Research List", async () => {
    await nightWith("2026-11-02", [QUILLFEATHER]);
    await nightWith("2026-11-03", [QUILLFEATHER, HARBOR_LANE]);

    expect(await listCompanies(researcher, { membership: "all", researchList: true })).toEqual([]);
  });

  it("records each run with its start, finish, outcome and membership result", async () => {
    await nightWith("2026-11-02", [QUILLFEATHER]);

    expect(await recentRuns(researcher)).toEqual([
      {
        runDate: "2026-11-02",
        startedAt: "2026-11-02T03:17:00+00:00",
        finishedAt: "2026-11-02T03:17:00+00:00",
        outcome: "succeeded",
        membershipUpdate: "applied",
        membershipNote: null,
        error: null,
        briefsWritten: 0,
        briefsDeferred: 0,
        briefsHeldBack: 0,
      },
    ]);
  });

  it("keeps a Company that leaves as a former member, with its history", async () => {
    await nightWith("2026-11-02", [HARBOR_LANE, QUILLFEATHER]);
    await nightWith("2026-11-03", [HARBOR_LANE]);

    const left = await company(QUILLFEATHER.cik);
    expect(left?.membership).toBe("former");
    expect(left?.history).toEqual([
      { change: "joined", seenOn: "2026-11-02" },
      { change: "left", seenOn: "2026-11-03" },
    ]);
    expect((await listCompanies(researcher, { membership: "current" })).map((c) => c.cik)).toEqual([
      HARBOR_LANE.cik,
    ]);
    expect((await listCompanies(researcher, { membership: "former" })).map((c) => c.cik)).toEqual([
      QUILLFEATHER.cik,
    ]);
  });

  it("brings a former member back as a current member, continuing its history and keeping its primary ticker", async () => {
    await nightWith("2026-11-02", [HARBOR_LANE]);
    await nightWith("2026-11-03", []);
    const reweighted = {
      ...HARBOR_LANE,
      tickers: [
        { ticker: "ZHLA", weight: 3.0 },
        { ticker: "ZHLB", weight: 1.0 },
      ],
    };
    await nightWith("2026-11-04", [reweighted]);

    const back = await company(HARBOR_LANE.cik);
    expect(back?.membership).toBe("current");
    expect(back?.primaryTicker).toBe("ZHLB");
    expect(back?.history).toEqual([
      { change: "joined", seenOn: "2026-11-02" },
      { change: "left", seenOn: "2026-11-03" },
      { change: "joined", seenOn: "2026-11-04" },
    ]);
  });

  it("never changes a primary ticker when the weights change, and adds a new share class beside it", async () => {
    await nightWith("2026-11-02", [QUILLFEATHER]);
    await nightWith("2026-11-03", [
      { ...QUILLFEATHER, tickers: [...QUILLFEATHER.tickers, { ticker: "ZQLG", weight: 2.0 }] },
    ]);

    const quill = await company(QUILLFEATHER.cik);
    expect(quill?.primaryTicker).toBe("ZQLF");
    expect(quill?.otherTickers).toEqual(["ZQLG"]);
  });

  it("refuses a list that would remove more than 10 current members, and leaves membership as it was", async () => {
    const members = fictionalCompanies(20);
    await nightWith("2026-11-02", members);

    // 11 gone at once, and one newcomer that must not join either.
    await nightWith("2026-11-03", [...members.slice(11), QUILLFEATHER]);

    expect(await listCompanies(researcher, { membership: "current" })).toHaveLength(20);
    expect(await company(QUILLFEATHER.cik)).toBeUndefined();
    const [latest] = await recentRuns(researcher);
    expect(latest.outcome).toBe("succeeded");
    expect(latest.membershipUpdate).toBe("refused");
    expect(latest.membershipNote).toBe("The list would remove 11 current members at once, more than the 10 allowed.");
  });

  it("applies a list that removes exactly 10 current members", async () => {
    const members = fictionalCompanies(20);
    await nightWith("2026-11-02", members);

    await nightWith("2026-11-03", members.slice(10));

    expect(await listCompanies(researcher, { membership: "current" })).toHaveLength(10);
    expect((await recentRuns(researcher))[0].membershipUpdate).toBe("applied");
  });

  it("ignores a Sector that isn't one of the 11 names, keeping the last valid one or showing none", async () => {
    await nightWith("2026-11-02", [QUILLFEATHER, { ...HARBOR_LANE, sector: "Interactive Media & Services" }]);
    expect((await company(HARBOR_LANE.cik))?.sector).toBeNull();

    await nightWith("2026-11-03", [{ ...QUILLFEATHER, sector: "Packaged Foods" }, HARBOR_LANE]);
    expect((await company(QUILLFEATHER.cik))?.sector).toBe("Consumer Staples");
    expect((await company(HARBOR_LANE.cik))?.sector).toBe("Communication Services");

    await nightWith("2026-11-04", [{ ...QUILLFEATHER, sector: undefined }, HARBOR_LANE]);
    expect((await company(QUILLFEATHER.cik))?.sector).toBe("Consumer Staples");
  });

  it("leaves out a ticker the SEC list doesn't know, and says so", async () => {
    const list = constituentList([QUILLFEATHER]);
    list.holdings.push({ ticker: "ZNOC", weight: 0.2 });

    await night("2026-11-02", fakeConstituentSource(list));

    expect((await listCompanies(researcher, { membership: "all" })).map((c) => c.cik)).toEqual([QUILLFEATHER.cik]);
    expect((await recentRuns(researcher))[0].membershipNote).toBe("No CIK found for: ZNOC.");
  });

  it("fails the run with a clear error when the constituent list can't be read", async () => {
    await nightWith("2026-11-02", [QUILLFEATHER]);

    await expect(night("2026-11-03", unreadableConstituentSource("SPY holdings: HTTP 503"))).rejects.toThrow(
      "SPY holdings: HTTP 503",
    );

    expect((await company(QUILLFEATHER.cik))?.membership).toBe("current");
    const [latest] = await recentRuns(researcher);
    expect(latest).toMatchObject({
      runDate: "2026-11-03",
      outcome: "failed",
      membershipUpdate: "failed",
      error: "SPY holdings: HTTP 503",
    });
  });
});
