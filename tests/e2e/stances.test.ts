import { expect, test } from "@playwright/test";
import {
  fictionalCompanies,
  HARBOR_LANE,
  QUILLFEATHER,
  type FictionalCompany,
} from "../support/fake-constituent-source";
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
const DATE = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/;

function nightWith(date: string, companies: FictionalCompany[]) {
  return runTestNight(stack, date, { companies });
}

test.beforeEach(async () => {
  await forgetResearchData(stack);
  await nightWith("2026-11-02", [HARBOR_LANE, QUILLFEATHER]);
});
test.afterAll(async () => {
  await forgetResearchData(stack);
  await forgetTestEmails(stack, [E2E_RESEARCHER_EMAIL]);
});

test("the Researcher sets a Stance with a note on a Company's page and sees every entry, newest first", async ({
  page,
}) => {
  await signInAsE2eResearcher(page, stack);

  await page.getByRole("link", { name: "Harbor Lane Holdings (fictional)" }).click();
  await expect(page.getByRole("heading", { name: "Harbor Lane Holdings (fictional)" })).toBeVisible();
  await expect(page.getByText("ZHLB · also ZHLA")).toBeVisible();
  await expect(page.getByText("Communication Services")).toBeVisible();
  await expect(page.getByText("Joined Nov 2, 2026")).toBeVisible();

  // Every Company starts Unreviewed, with no entries yet.
  await expect(page.getByText("Current Stance: Unreviewed")).toBeVisible();
  await expect(page.getByText("No Stance entries yet.")).toBeVisible();

  await page.getByLabel("New Stance").selectOption("Watching");
  await page.getByLabel("Note").fill("Ad revenue slowing; check next quarter");
  await page.getByRole("button", { name: "Set Stance" }).click();
  await expect(page.getByText("Current Stance: Watching")).toBeVisible();

  await page.getByLabel("New Stance").selectOption("Candidate");
  await page.getByLabel("Note").fill("Cheaper than its Sector after the drop");
  await page.getByRole("button", { name: "Set Stance" }).click();

  // The current Stance is the newest entry, and the history keeps both with their dates.
  await expect(page.getByText("Current Stance: Candidate")).toBeVisible();
  const history = page.getByRole("list", { name: "Stance history" }).getByRole("listitem");
  await expect(history).toHaveCount(2);
  await expect(history.nth(0)).toContainText("Candidate");
  await expect(history.nth(0)).toContainText("Cheaper than its Sector after the drop");
  await expect(history.nth(1)).toContainText("Watching");
  await expect(history.nth(1)).toContainText("Ad revenue slowing; check next quarter");
  await expect(history.nth(0).locator("time")).toHaveText(DATE);

  // No Stance entry can be edited or removed from the page.
  await expect(
    page.getByRole("region", { name: "Stance", exact: true }).getByRole("button", { name: /edit|delete|remove/i }),
  ).toHaveCount(0);
});

test("a Stance needs a note", async ({ page }) => {
  await signInAsE2eResearcher(page, stack);
  await page.goto(`/companies/${QUILLFEATHER.cik}`);

  await page.getByLabel("New Stance").selectOption("Avoid");
  await page.getByLabel("Note").fill("   ");
  await page.getByRole("button", { name: "Set Stance" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "Add a short note saying why." })).toBeVisible();
  await expect(page.getByText("No Stance entries yet.")).toBeVisible();
});

test("the Company list shows each current Stance and filters by it", async ({ page }) => {
  const [newcomer] = fictionalCompanies(1);
  await nightWith("2026-11-03", [HARBOR_LANE, QUILLFEATHER, newcomer]);
  await nightWith("2026-11-04", [HARBOR_LANE, newcomer]);
  await withDb(stack, async (db) => {
    const add = (cik: string, stance: string, note: string) =>
      db.query("insert into public.stance_entries (cik, stance, note) values ($1, $2, $3)", [cik, stance, note]);
    await add(HARBOR_LANE.cik, "Avoid", "First look");
    await add(HARBOR_LANE.cik, "Candidate", "Changed my mind");
    await add(QUILLFEATHER.cik, "Candidate", "Worth a look even after leaving");
  });

  await signInAsE2eResearcher(page, stack);

  // Current members, each with its current Stance; a Company with no entries is Unreviewed.
  await expect(page.getByRole("row", { name: /Harbor Lane/ }).getByRole("cell", { name: "Candidate" })).toBeVisible();
  await expect(
    page.getByRole("row", { name: /Fictional Company 1/ }).getByRole("cell", { name: "Unreviewed" }),
  ).toBeVisible();

  const stances = page.getByRole("navigation", { name: "Stance" });
  await stances.getByRole("link", { name: "Candidate" }).click();
  await expect(page).toHaveURL("/?stance=Candidate");
  await expect(page.getByRole("row")).toHaveCount(2);
  await expect(page.getByRole("row", { name: /Harbor Lane/ })).toBeVisible();

  // A superseded Stance doesn't count.
  await stances.getByRole("link", { name: "Avoid" }).click();
  await expect(page.getByText("No Companies here.")).toBeVisible();

  await stances.getByRole("link", { name: "Unreviewed" }).click();
  await expect(page.getByRole("row")).toHaveCount(2);
  await expect(page.getByRole("row", { name: /Fictional Company 1/ })).toBeVisible();

  // The Stance filter combines with the membership filter.
  await stances.getByRole("link", { name: "Candidate" }).click();
  await expect(page).toHaveURL("/?stance=Candidate");
  await page.getByRole("navigation", { name: "Index Membership" }).getByRole("link", { name: "All" }).click();
  await expect(page).toHaveURL("/?membership=all&stance=Candidate");
  await expect(page.getByRole("row")).toHaveCount(3);

  await stances.getByRole("link", { name: "Any Stance" }).click();
  await expect(page).toHaveURL("/?membership=all");
  await expect(page.getByRole("row")).toHaveCount(4);
});
