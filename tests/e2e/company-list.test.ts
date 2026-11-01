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

const MARSH_GLASS: FictionalCompany = {
  cik: "9100000003",
  name: "Marsh Glassworks (fictional)",
  sector: "Specialty Glass",
  tickers: [{ ticker: "ZMGW", weight: 0.3 }],
};

function nightWith(date: string, companies: FictionalCompany[]) {
  return runTestNight(stack, date, { companies });
}

test.afterAll(async () => {
  await forgetResearchData(stack);
  await forgetTestEmails(stack, [E2E_RESEARCHER_EMAIL]);
});

test("the Company list shows tickers and Sectors, filtered by current or former membership", async ({ page }) => {
  await forgetResearchData(stack);
  await nightWith("2026-11-02", [HARBOR_LANE, QUILLFEATHER, MARSH_GLASS]);
  await nightWith("2026-11-03", [HARBOR_LANE, MARSH_GLASS]);

  await signInAsE2eResearcher(page, stack);

  // Current members by default, with the primary ticker, the other share classes and the Sector.
  await expect(page.getByRole("link", { name: "Current members" })).toHaveAttribute("aria-current", "page");
  const rows = page.getByRole("row");
  await expect(rows).toHaveCount(3);
  const harbor = page.getByRole("row", { name: /Harbor Lane Holdings/ });
  await expect(harbor.getByRole("cell", { name: "ZHLB", exact: true })).toBeVisible();
  await expect(harbor.getByRole("cell", { name: "ZHLA", exact: true })).toBeVisible();
  await expect(harbor.getByRole("cell", { name: "Communication Services" })).toBeVisible();
  // A Sector that isn't one of the 11 names shows as not found.
  const marsh = page.getByRole("row", { name: /Marsh Glassworks/ });
  await expect(marsh.getByRole("cell", { name: "not found" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Quillfeather/ })).toHaveCount(0);

  // Former members, with the date the app saw them leave.
  await page.getByRole("link", { name: "Former members" }).click();
  await expect(page).toHaveURL("/?membership=former");
  await expect(page.getByRole("row")).toHaveCount(2);
  const quill = page.getByRole("row", { name: /Quillfeather Foods/ });
  await expect(quill.getByRole("cell", { name: "Left Nov 3, 2026" })).toBeVisible();

  // All of them.
  await page.getByRole("link", { name: "All" }).click();
  await expect(page).toHaveURL("/?membership=all");
  await expect(page.getByRole("row")).toHaveCount(4);
});
