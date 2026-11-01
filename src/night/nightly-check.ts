import type { SupabaseClient } from "@supabase/supabase-js";
import { KEY_FACTS } from "../lib/key-facts";
import type { MarketDataProvider, Metrics } from "./market-data";
import { sectorMedians } from "./sector-median";
import type { Sector } from "./sectors";

/** How many of the largest current members start the Research List at the first run. */
export const FIRST_RUN_LIST_SIZE = 100;

function check<T>(result: { data: T | null; error: { message: string } | null }, doing: string): T {
  if (result.error) throw new Error(`Could not ${doing}: ${result.error.message}`);
  return result.data as T;
}

type Member = { cik: string; sector: Sector | null; tickers: { ticker: string; is_primary: boolean }[] };

/**
 * Checks every current member: saves tonight's quote, metrics and ratings as a snapshot for the run,
 * then the Sector Medians. On the first run that finds market caps it also starts the Research List
 * with the largest members.
 */
export async function runNightlyCheck(db: SupabaseClient, marketData: MarketDataProvider, runId: number) {
  const members = check(
    await db
      .from("companies")
      .select("cik, sector, tickers(ticker, is_primary)")
      .eq("is_current_member", true)
      .order("cik")
      .returns<Member[]>(),
    "read the current members",
  );
  // The list starts once, on the first run that finds market caps; after that only the Researcher changes it.
  const listStarted =
    check(
      await db.from("research_list_changes").select("id").eq("reason", "first_run").limit(1),
      "read the Research List",
    ).length > 0;

  const checked: { cik: string; sector: Sector | null; metrics: Metrics }[] = [];
  const rows = [];
  for (const member of members) {
    const ticker = member.tickers.find((t) => t.is_primary)?.ticker;
    if (!ticker) continue;
    const quote = await marketData.quote(ticker);
    const metrics = await marketData.metrics(ticker);
    const ratings = await marketData.ratings(ticker);
    checked.push({ cik: member.cik, sector: member.sector, metrics });
    rows.push({
      run_id: runId,
      cik: member.cik,
      ticker,
      price: quote?.price ?? null,
      previous_close: quote?.previousClose ?? null,
      market_cap: metrics.marketCap,
      ...Object.fromEntries(KEY_FACTS.map((f) => [f.column, metrics[f.key]])),
      ratings,
    });
  }
  if (rows.length > 0) check(await db.from("company_snapshots").insert(rows), "save tonight's snapshots");

  const medians = sectorMedians(checked.map(({ sector, metrics }) => ({ sector, facts: metrics })));
  if (medians.length > 0) {
    check(
      await db.from("sector_medians").insert(
        medians.map((m) => ({
          run_id: runId,
          sector: m.sector,
          fact: KEY_FACTS.find((f) => f.key === m.fact)!.column,
          median: m.median,
          companies: m.companies,
        })),
      ),
      "save the Sector Medians",
    );
  }

  if (!listStarted) {
    const largest = checked
      .filter((c) => c.metrics.marketCap !== null)
      .sort((a, b) => b.metrics.marketCap! - a.metrics.marketCap!)
      .slice(0, FIRST_RUN_LIST_SIZE);
    if (largest.length > 0) {
      check(
        await db
          .from("research_list_changes")
          .insert(largest.map((c) => ({ cik: c.cik, change: "added", reason: "first_run" }))),
        "start the Research List",
      );
    }
  }
}
