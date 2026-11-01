import { expect, test } from "@playwright/test";
import {
  HARBOR_LANE,
  QUILLFEATHER,
  type FictionalCompany,
} from "../support/fake-constituent-source";
import {
  E2E_RESEARCHER_EMAIL,
  forgetResearchData,
  forgetTestEmails,
  readLocalSupabase,
} from "../support/local-supabase";
import { runTestNight } from "../support/nights";
import { signInAsE2eResearcher } from "../support/sign-in";

const stack = readLocalSupabase();

function nightWith(date: string, companies: FictionalCompany[]) {
  return runTestNight(stack, date, { companies });
}

test.afterAll(async () => {
  await forgetResearchData(stack);
  await forgetTestEmails(stack, [E2E_RESEARCHER_EMAIL]);
});

test("the Researcher adds and removes Companies on the Research List, by hand and through a Stance", async ({
  page,
}) => {
  await forgetResearchData(stack);
  await nightWith("2026-11-02", [HARBOR_LANE, QUILLFEATHER]);
  await signInAsE2eResearcher(page, stack);

  // Nothing is on the list until the Researcher puts it there.
  const listFilter = page.getByRole("navigation", { name: "Research List" });
  await listFilter.getByRole("link", { name: "On the Research List" }).click();
  await expect(page).toHaveURL("/?list=on");
  await expect(page.getByText("No Companies here.")).toBeVisible();

  // By hand.
  await page.goto(`/companies/${QUILLFEATHER.cik}`);
  const list = page.getByRole("region", { name: "Research List" });
  await expect(list.getByText("Not on the Research List")).toBeVisible();
  await list.getByRole("button", { name: "Add to the Research List" }).click();
  await expect(list.getByText("On the Research List", { exact: true })).toBeVisible();
  await list.getByRole("button", { name: "Remove from the Research List" }).click();
  await expect(list.getByText("Not on the Research List")).toBeVisible();
  const changes = list.getByRole("list", { name: "Research List history" }).getByRole("listitem");
  await expect(changes).toHaveCount(2);
  await expect(changes.nth(0)).toContainText("Removed by hand");
  await expect(changes.nth(1)).toContainText("Added by hand");

  // Through a Stance.
  await page.goto(`/companies/${HARBOR_LANE.cik}`);
  await page.getByLabel("New Stance").selectOption("Watching");
  await page.getByLabel("Note").fill("Following the ad market");
  await page.getByRole("button", { name: "Set Stance" }).click();
  await expect(page.getByText("Current Stance: Watching")).toBeVisible();
  await expect(list.getByText("On the Research List", { exact: true })).toBeVisible();
  await expect(changes.nth(0)).toContainText("Added when the Stance became Watching or Candidate");

  // The filter shows only Companies on the list.
  await page.goto("/?list=on");
  await expect(page.getByRole("row")).toHaveCount(2);
  await expect(page.getByRole("row", { name: /Harbor Lane/ })).toBeVisible();
});
