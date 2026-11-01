import { expect, test } from "@playwright/test";
import { fakeMarketData } from "../support/fake-market-data";
import {
  E2E_RESEARCHER_EMAIL,
  forgetResearchData,
  forgetTestEmails,
  readLocalSupabase,
} from "../support/local-supabase";
import { runTestNight } from "../support/nights";
import { signInAsE2eResearcher } from "../support/sign-in";

const stack = readLocalSupabase();

const KILN = {
  cik: "9300000011",
  name: "Kilnworth Ceramics (fictional)",
  sector: "Materials",
  tickers: [{ ticker: "ZKLN", weight: 0.2 }],
};
const LODE = {
  cik: "9300000012",
  name: "Lodestar Alloys (fictional)",
  sector: "Materials",
  tickers: [{ ticker: "ZLDS", weight: 0.3 }],
};

test.afterAll(async () => {
  await forgetResearchData(stack);
  await forgetTestEmails(stack, [E2E_RESEARCHER_EMAIL]);
});

test("the Company page shows each key fact beside its Sector Median", async ({ page }) => {
  await forgetResearchData(stack);
  await runTestNight(stack, "2026-11-02", {
    companies: [KILN, LODE],
    marketData: fakeMarketData({
      ZKLN: { quote: { price: 23.4, previousClose: 23 }, metrics: { forwardPe: 14.5, grossMargin: 31.25 } },
      ZLDS: { quote: { price: 80, previousClose: 79 }, metrics: { forwardPe: 21.5, grossMargin: 40 } },
    }),
  });

  await signInAsE2eResearcher(page, stack);
  await page.goto(`/companies/${KILN.cik}`);

  const facts = page.getByRole("table", { name: "Key facts" });
  await expect(page.getByText("As of the Nightly Check on Nov 2, 2026")).toBeVisible();
  await expect(page.getByText("Price: $23.40")).toBeVisible();
  const forwardPe = facts.getByRole("row", { name: /Forward P\/E/ });
  await expect(forwardPe.getByRole("cell").nth(0)).toHaveText("14.5");
  await expect(forwardPe.getByRole("cell").nth(1)).toHaveText("18");
  const margin = facts.getByRole("row", { name: /Gross margin/ });
  await expect(margin.getByRole("cell").nth(0)).toHaveText("31.3%");
  await expect(margin.getByRole("cell").nth(1)).toHaveText("35.6%");
  const peg = facts.getByRole("row", { name: /PEG/ });
  await expect(peg.getByRole("cell").nth(0)).toHaveText("not found");
  await expect(peg.getByRole("cell").nth(1)).toHaveText("not found");
});
