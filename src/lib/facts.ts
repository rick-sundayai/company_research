import type { SupabaseClient } from "@supabase/supabase-js";
import type { RatingCounts } from "../night/market-data";
import { KEY_FACTS, type FactKey, type KeyFact } from "./key-facts";

export type CompanyFacts = {
  /** The run date of the Company's latest Nightly Check. */
  asOf: string;
  price: number | null;
  previousClose: number | null;
  ratings: RatingCounts[];
  /** Each key fact beside its Sector Median; null is "not found". */
  facts: { key: FactKey; label: string; unit: KeyFact["unit"]; value: number | null; sectorMedian: number | null }[];
};

type SnapshotRow = Record<string, unknown> & {
  run_id: number;
  price: number | null;
  previous_close: number | null;
  ratings: RatingCounts[];
  nightly_runs: { run_date: string };
  companies: { sector: string | null };
};

/** A Company's facts from its latest Nightly Check, or null when it has never been checked. */
export async function companyFacts(supabase: SupabaseClient, cik: string): Promise<CompanyFacts | null> {
  const snapshot = await supabase
    .from("company_snapshots")
    .select("*, nightly_runs(run_date), companies(sector)")
    .eq("cik", cik)
    .order("run_id", { ascending: false })
    .limit(1)
    .returns<SnapshotRow[]>();
  if (snapshot.error) throw new Error(`Could not read the Company's facts: ${snapshot.error.message}`);
  const latest = snapshot.data[0];
  if (!latest) return null;

  const sector = latest.companies.sector;
  const medians = new Map<string, number>();
  if (sector) {
    const { data, error } = await supabase
      .from("sector_medians")
      .select("fact, median")
      .eq("run_id", latest.run_id)
      .eq("sector", sector)
      .returns<{ fact: string; median: number }[]>();
    if (error) throw new Error(`Could not read the Sector Medians: ${error.message}`);
    for (const row of data) medians.set(row.fact, row.median);
  }

  return {
    asOf: latest.nightly_runs.run_date,
    price: latest.price,
    previousClose: latest.previous_close,
    ratings: latest.ratings,
    facts: KEY_FACTS.map((f) => ({
      key: f.key,
      label: f.label,
      unit: f.unit,
      value: (latest[f.column] as number | null) ?? null,
      sectorMedian: medians.get(f.column) ?? null,
    })),
  };
}
