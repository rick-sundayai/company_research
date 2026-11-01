import { expect, test } from "@playwright/test";
import type { FictionalCompany } from "../support/fake-constituent-source";
import { fakeAiWriter } from "../support/fake-ai-writer";
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

const YARROW: FictionalCompany = {
  cik: "9700000001",
  name: "Yarrow Freight (fictional)",
  sector: "Industrials",
  tickers: [{ ticker: "ZYRW", weight: 0.4 }],
};

test.afterAll(async () => {
  await forgetResearchData(stack);
  await forgetTestEmails(stack, [E2E_RESEARCHER_EMAIL]);
});

test("the Researcher reads a Brief on the Company page and from the Digest, with the budget shown", async ({ page }) => {
  await forgetResearchData(stack);
  await runTestNight(stack, "2026-11-02", { companies: [YARROW] });
  await withDb(stack, (db) =>
    db.query("insert into public.research_list_changes (cik, change, reason) values ($1, 'added', 'by_hand')", [
      YARROW.cik,
    ]),
  );
  await runTestNight(stack, "2026-11-03", {
    companies: [YARROW],
    marketData: fakeMarketData({
      ZYRW: {
        quote: { price: 31, previousClose: 30 },
        metrics: { forwardPe: 12.5 },
        news: [
          {
            headline: "Yarrow adds a route",
            source: "Fictional Wire",
            url: "https://news.example.test/yarrow",
            publishedAt: "2026-11-02T09:00:00Z",
          },
        ],
      },
    }),
  });

  await signInAsE2eResearcher(page, stack);
  await page.getByRole("link", { name: "Digest" }).click();
  await expect(page.getByText("Research Budget: $0.01 spent of $10.00 this month, $9.99 left")).toBeVisible();
  const noBrief = page.getByRole("region", { name: "No Brief yet" });
  await noBrief.getByRole("link", { name: "Read the Brief" }).click();

  const brief = page.getByRole("article", { name: "Brief of Nov 3, 2026" });
  await expect(brief.getByText("Triggers: No Brief yet")).toBeVisible();
  await expect(brief.getByText(/machine-written by fake-writer/)).toBeVisible();
  await expect(brief.getByText("Bull case: Yarrow Freight (fictional) has room to grow")).toBeVisible();
  await expect(
    brief.getByRole("list", { name: "News" }).getByRole("link", { name: "Yarrow adds a route" }),
  ).toHaveAttribute("href", "https://news.example.test/yarrow");
  const forwardPe = brief.getByRole("row", { name: /Forward P\/E/ });
  await expect(forwardPe.getByRole("cell").nth(0)).toHaveText("12.5");
  await expect(brief.getByRole("row", { name: /^PEG/ }).getByRole("cell").nth(0)).toHaveText("not found");

  await page.goto(`/companies/${YARROW.cik}`);
  await expect(page.getByRole("article", { name: "Brief of Nov 3, 2026" })).toBeVisible();
  const history = page.getByRole("list", { name: "Brief history" }).getByRole("listitem");
  await expect(history).toHaveCount(1);
  await expect(history.first()).toContainText("Nov 3, 2026");
});

test("a Brief held back by the Source Check is listed with its reasons and counted in the Digest", async ({ page }) => {
  await forgetResearchData(stack);
  await runTestNight(stack, "2026-11-02", { companies: [YARROW] });
  await withDb(stack, (db) =>
    db.query("insert into public.research_list_changes (cik, change, reason) values ($1, 'added', 'by_hand')", [
      YARROW.cik,
    ]),
  );
  await runTestNight(stack, "2026-11-03", {
    companies: [YARROW],
    aiWriter: fakeAiWriter({ summary: () => "Bull case: margins of 77% [facts] and a merger [news-9]." }),
  });

  await signInAsE2eResearcher(page, stack);
  await page.goto("/digest");
  await expect(page.getByText("1 Brief was held back by the Source Check.")).toBeVisible();
  await expect(page.getByRole("region", { name: "No Brief yet" }).getByText("Brief held back by the Source Check")).toBeVisible();

  await page.goto(`/companies/${YARROW.cik}`);
  await expect(page.getByText("No Brief yet.")).toBeVisible();
  const held = page.getByRole("region", { name: "Held back by the Source Check" });
  await expect(held.getByText("The number 77% matches no fact in the Brief.")).toBeVisible();
  await expect(held.getByText("Cites [news-9], which is not a source in the Brief.")).toBeVisible();
});

test("the Researcher requests a fresh Brief, sees it pending, and reads it after the next run", async ({ page }) => {
  await forgetResearchData(stack);
  await runTestNight(stack, "2026-11-02", { companies: [YARROW] });
  await withDb(stack, (db) =>
    db.query("insert into public.research_list_changes (cik, change, reason) values ($1, 'added', 'by_hand')", [
      YARROW.cik,
    ]),
  );
  await runTestNight(stack, "2026-11-03", { companies: [YARROW] });

  await signInAsE2eResearcher(page, stack);
  await page.goto(`/companies/${YARROW.cik}`);
  const briefs = page.getByRole("region", { name: "Briefs" });
  await briefs.getByRole("button", { name: "Request a Brief" }).click();
  await expect(briefs.getByText(/^Brief requested on .*: the next overnight run writes it first\.$/)).toBeVisible();
  await expect(briefs.getByRole("button", { name: "Request a Brief" })).toHaveCount(0);

  await runTestNight(stack, "2026-11-04", { companies: [YARROW] });
  await page.reload();

  await expect(page.getByRole("article", { name: "Brief of Nov 4, 2026" }).getByText("Triggers: Requested")).toBeVisible();
  await expect(briefs.getByRole("button", { name: "Request a Brief" })).toBeVisible();
});
