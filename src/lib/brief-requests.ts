import type { SupabaseClient } from "@supabase/supabase-js";

/** The Company's request for a fresh Brief that the nightly job hasn't written yet, or null. */
export async function pendingRequest(supabase: SupabaseClient, cik: string): Promise<{ requestedAt: string } | null> {
  const { data, error } = await supabase
    .from("brief_requests")
    .select("requested_at")
    .eq("cik", cik)
    .is("done_run_id", null)
    .limit(1)
    .returns<{ requested_at: string }[]>();
  if (error) throw new Error(`Could not read the Brief requests: ${error.message}`);
  return data[0] ? { requestedAt: data[0].requested_at } : null;
}

/** The Researcher asks for a fresh Brief; asking again while one is pending changes nothing. */
export async function requestBrief(supabase: SupabaseClient, cik: string) {
  if (await pendingRequest(supabase, cik)) return;
  const { error } = await supabase.from("brief_requests").insert({ cik });
  if (error) throw new Error(`Could not request a Brief: ${error.message}`);
}
