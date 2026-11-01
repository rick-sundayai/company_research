import { expect, test } from "@playwright/test";
import type { FictionalCompany } from "../support/fake-constituent-source";
import { fakeMarketData } from "../support/fake-market-data";
import {
  E2E_RESEARCHER_EMAIL,
  forgetResearchData,
  forgetTestEmails,
  readLocalSupabase,
  withDb,
} from "../support/local-supabase";
import { runTestNight } from "../support/nights";
import { signInAsE2eResearcher } from "../support/sign-in";

const stack = readLocalSupabase();

const company = (n: number, name: string, ticker: string): FictionalCompany => ({
  cik: String(9_500_000_000 + n),
  name: `${name} (fictional)`,
  sector: "Energy",
  tickers: [{ ticker, weight: 0.1 }],
});
const RIDGE = company(1, "Ridgeway Solar", "ZRDG");
const SPRUCE = company(2, "Spruce Turbines", "ZSPT");
const COMPANIES = [RIDGE, SPRUCE];

/** Pretends the latest run finished `hours` ago. */
const finishedHoursAgo = (hours: number) =>
  withDb(stack, (db) =>
    db.query(
      `update public.nightly_runs set started_at = now() - make_interval(hours => $1),
         finished_at = now() - make_interval(hours => $1)
       where id = (select max(id) from public.nightly_runs)`,
      [hours],
    ),
  );

test.beforeEach(() => forgetResearchData(stack));
test.afterAll(async () => {
  await forgetResearchData(stack);
  await forgetTestEmails(stack, [E2E_RESEARCHER_EMAIL]);
});

test("the Digest shows the latest night's Triggers, and an off-list Company can be added from it", async ({ page }) => {
  await runTestNight(stack, "2026-11-02", { companies: COMPANIES });
  await withDb(stack, (db) =>
    db.query("insert into public.research_list_changes (cik, change, reason) values ($1, 'added', 'by_hand')", [
      RIDGE.cik,
    ]),
  );
  await runTestNight(stack, "2026-11-03", {
    companies: COMPANIES,
    marketData: fakeMarketData(
      { ZSPT: { quote: { price: 77, previousClose: 70 } } },
      [{ ticker: "ZRDG", date: "2026-11-03", epsActual: 0.8, epsEstimate: 0.7 }],
    ),
  });

  await signInAsE2eResearcher(page, stack);
  await page.getByRole("link", { name: "Digest" }).click();

  await expect(page.getByRole("heading", { name: "Digest for the night of Nov 3, 2026" })).toBeVisible();
  const onList = page.getByRole("region", { name: "Earnings reported" });
  await expect(onList.getByRole("link", { name: "Ridgeway Solar (fictional)" })).toBeVisible();
  await expect(onList.getByText("Reported Nov 3, 2026: EPS 0.8 against 0.7 expected")).toBeVisible();

  const offList = page.getByRole("region", { name: "Off the Research List" });
  const spruce = offList.getByRole("listitem").filter({ hasText: "Spruce Turbines (fictional)" });
  await expect(spruce.getByText("Price move: up 10% in a day ($70.00 to $77.00)")).toBeVisible();
  await spruce.getByRole("button", { name: "Add to the Research List" }).click();
  await expect(spruce.getByText("Added to the Research List")).toBeVisible();

  await page.goto(`/companies/${SPRUCE.cik}`);
  await expect(page.getByText("On the Research List", { exact: true })).toBeVisible();
});

test("a quiet night shows an empty Digest that says so", async ({ page }) => {
  await runTestNight(stack, "2026-11-02", {
    companies: COMPANIES,
    marketData: fakeMarketData({ ZSPT: { quote: { price: 77, previousClose: 70 } } }),
  });
  await runTestNight(stack, "2026-11-03", { companies: COMPANIES });

  await signInAsE2eResearcher(page, stack);
  await page.goto("/digest");

  await expect(page.getByRole("heading", { name: "Digest for the night of Nov 3, 2026" })).toBeVisible();
  await expect(page.getByText("Nothing fired that night.")).toBeVisible();
  await expect(page.getByText("Spruce Turbines (fictional)")).toHaveCount(0);
});

test("a banner warns when the latest successful run finished more than 30 hours ago", async ({ page }) => {
  await runTestNight(stack, "2026-11-02", { companies: COMPANIES });
  await finishedHoursAgo(29);
  await signInAsE2eResearcher(page, stack);
  await expect(page.getByRole("heading", { name: "Companies" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "overnight run" })).toHaveCount(0);

  await finishedHoursAgo(31);
  await page.goto("/digest");
  await expect(page.getByRole("status").filter({ hasText: "The last successful overnight run finished" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("status").filter({ hasText: "The last successful overnight run finished" })).toBeVisible();
});
