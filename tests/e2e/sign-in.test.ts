import { expect, test } from "@playwright/test";
import { E2E_RESEARCHER_EMAIL, forgetResearchData, forgetTestEmails, readLocalSupabase } from "../support/local-supabase";
import { latestSignInLink, resetE2eResearcher } from "../support/sign-in";

const stack = readLocalSupabase();

test.afterAll(() => forgetTestEmails(stack, [E2E_RESEARCHER_EMAIL]));

test("the Researcher signs in by email link to an empty Company list, and signs out", async ({ page }) => {
  await forgetResearchData(stack);
  await resetE2eResearcher(stack);

  // A visitor who has not signed in is sent to sign-in.
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);

  // Any other email is refused.
  await page.getByLabel("Email").fill("stranger@example.test");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText("That email is not allowed to sign in.")).toBeVisible();

  // The allowed email gets a link, which signs them in.
  await page.getByLabel("Email").fill(E2E_RESEARCHER_EMAIL);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("status")).toHaveText("Check your email for a sign-in link.");
  await page.goto(await latestSignInLink(stack, E2E_RESEARCHER_EMAIL));

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Companies" })).toBeVisible();
  await expect(page.getByText("No Companies yet")).toBeVisible();

  // Signing out puts the Company list behind sign-in again.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
});
