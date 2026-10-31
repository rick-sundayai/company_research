import { expect, type Page } from "@playwright/test";
import { allowResearcherEmail, E2E_RESEARCHER_EMAIL, forgetTestEmails, type LocalSupabase } from "./local-supabase";

type MailpitList = { messages: { ID: string; To: { Address: string }[] }[] };

export async function latestSignInLink(stack: LocalSupabase, to: string): Promise<string> {
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

/** Starts clean for the dedicated e2e Researcher only; the developer's own Researcher and mail are never touched. */
export async function resetE2eResearcher(stack: LocalSupabase) {
  await forgetTestEmails(stack, [E2E_RESEARCHER_EMAIL]);
  await allowResearcherEmail(stack, E2E_RESEARCHER_EMAIL);
  await fetch(`${stack.mailUrl}/api/v1/search?query=${encodeURIComponent(`to:${E2E_RESEARCHER_EMAIL}`)}`, {
    method: "DELETE",
  });
}

/** Signs the e2e Researcher in through the sign-in page and the emailed link. */
export async function signInAsE2eResearcher(page: Page, stack: LocalSupabase) {
  await resetE2eResearcher(stack);
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(E2E_RESEARCHER_EMAIL);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("status")).toHaveText("Check your email for a sign-in link.");
  await page.goto(await latestSignInLink(stack, E2E_RESEARCHER_EMAIL));
  await expect(page).toHaveURL("/");
}
