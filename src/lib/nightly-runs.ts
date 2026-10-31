import type { SupabaseClient } from "@supabase/supabase-js";

export type NightlyRun = {
  runDate: string;
  startedAt: string;
  finishedAt: string | null;
  outcome: "running" | "succeeded" | "failed";
  membershipUpdate: "applied" | "refused" | "failed" | null;
  membershipNote: string | null;
  error: string | null;
};

/** The latest overnight runs, newest first. */
export async function recentRuns(supabase: SupabaseClient, limit = 10): Promise<NightlyRun[]> {
  const { data, error } = await supabase
    .from("nightly_runs")
    .select("run_date, started_at, finished_at, outcome, membership_update, membership_note, error")
    .order("started_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not read the nightly runs: ${error.message}`);

  return data.map((run) => ({
    runDate: run.run_date,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    outcome: run.outcome,
    membershipUpdate: run.membership_update,
    membershipNote: run.membership_note,
    error: run.error,
  }));
}
