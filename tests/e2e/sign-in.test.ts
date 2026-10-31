import { expect, test } from "@playwright/test";
import {
  allowResearcherEmail,
  E2E_RESEARCHER_EMAIL,
  forgetTestEmails,
  readLocalSupabase,
} from "../support/local-supabase";

const stack = readLocalSupabase();

type MailpitList = { messages: { ID: string; To: { Address: string }[] }[] };

async function latestSignInLink(to: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const list: MailpitList = await (await fetch(`${stack.mailUrl}/api/v1/messages`)).json();
    const message = list.messages.find((m) => m.To.some((t) => t.Address === to));
    if (message) {
      const detail = await (await fetch(`${stack.mailUrl}/api/v1/message/${message.ID}`)).json();
      const link = /href="([^"]*\/auth\/v1\/verify[^"]*)"/.exec(detail.HTML)?.[1];
      if (link) return link.replaceAll("&amp;", "&");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No sign-in email arrived for ${to}`);
}

test.afterAll(() => forgetTestEmails(stack, [E2E_RESEARCHER_EMAIL]));

test("the Researcher signs in by email link to an empty Company list, and signs out", async ({ page }) => {
  // Start clean for the dedicated e2e Researcher only; the developer's own Researcher and mail are never touched.
  await forgetTestEmails(stack, [E2E_RESEARCHER_EMAIL]);
  await allowResearcherEmail(stack, E2E_RESEARCHER_EMAIL);
  await fetch(`${stack.mailUrl}/api/v1/search?query=${encodeURIComponent(`to:${E2E_RESEARCHER_EMAIL}`)}`, {
    method: "DELETE",
  });

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
  await page.goto(await latestSignInLink(E2E_RESEARCHER_EMAIL));

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Companies" })).toBeVisible();
  await expect(page.getByText("No Companies yet")).toBeVisible();

  // Signing out puts the Company list behind sign-in again.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
});
