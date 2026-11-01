import type { SupabaseClient } from "@supabase/supabase-js";
import { researchListCiks } from "./decide-triggers";
import type { FilingsSource } from "./filings-source";

function check<T>(result: { data: T | null; error: { message: string } | null }, doing: string): T {
  if (result.error) throw new Error(`Could not ${doing}: ${result.error.message}`);
  return result.data as T;
}

/**
 * Lists the 10-K and 10-Q Filings of every current member on the Research List, and records the ones
 * not seen before. The first time a Company is looked at, its existing Filings are recorded without
 * firing the new-Filing Trigger; after that, each new one fires it.
 */
export async function checkFilings(db: SupabaseClient, filings: FilingsSource, runId: number) {
  const onList = await researchListCiks(db);
  const members = check(
    await db
      .from("companies")
      .select("cik")
      .eq("is_current_member", true)
      .in("cik", [...onList])
      .order("cik")
      .returns<{ cik: string }[]>(),
    "read the Research List's current members",
  );

  for (const { cik } of members) {
    const listed = await filings.list(cik);
    const seen = check(
      await db.from("filings").select("accession").eq("cik", cik).returns<{ accession: string }[]>(),
      "read the recorded Filings",
    );
    const firstLook = seen.length === 0;
    const known = new Set(seen.map((f) => f.accession));
    const unseen = listed.filter((f) => !known.has(f.accession));
    if (unseen.length === 0) continue;
    check(
      await db.from("filings").insert(
        unseen.map((f) => ({
          accession: f.accession,
          cik,
          form: f.form,
          filed_on: f.filedOn,
          report_date: f.reportDate,
          url: f.url,
          first_seen_run_id: runId,
          fires_trigger: !firstLook,
        })),
      ),
      "record new Filings",
    );
  }
}
