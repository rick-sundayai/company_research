import { expect, test, type Page } from "@playwright/test";
import { DEMO_COMPANIES, seedDemo } from "../../src/demo/seed";
import {
  adminClient,
  E2E_RESEARCHER_EMAIL,
  forgetResearchData,
  forgetTestEmails,
  readLocalSupabase,
} from "../support/local-supabase";
import { signInAsE2eResearcher } from "../support/sign-in";

const stack = readLocalSupabase();

test.afterAll(async () => {
  await forgetResearchData(stack);
  await forgetTestEmails(stack, [E2E_RESEARCHER_EMAIL]);
});

const expectLabel = (page: Page) =>
  expect(page.getByRole("note").filter({ hasText: "Fictional sample data" })).toBeVisible();

test("in demo mode, every page says it shows fictional sample data", async ({ page }) => {
  await forgetResearchData(stack);
  await seedDemo(adminClient(stack), { today: new Date().toISOString().slice(0, 10) });

  await page.goto("/sign-in");
  await expectLabel(page);

  await signInAsE2eResearcher(page, stack);
  await expectLabel(page);
  await expect(page.getByRole("row")).not.toHaveCount(0);

  const [first] = DEMO_COMPANIES;
  await page.goto(`/companies/${first.cik}`);
  await expectLabel(page);

  await page.getByRole("list", { name: "Brief history" }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/briefs\/\d+$/);
  await expectLabel(page);

  await page.goto("/digest");
  await expectLabel(page);
  await expect(page.getByRole("heading", { name: /^Digest for the night of/ })).toBeVisible();
});
