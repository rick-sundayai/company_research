import type { SupabaseClient } from "@supabase/supabase-js";

/** A run that finished longer ago than this means a night was missed. */
export const MISSED_NIGHT_HOURS = 30;

/**
 * When the last successful run finished, if that was more than 30 hours ago (or there has never been
 * one although runs have started); otherwise null. Before any run at all there is nothing to warn about.
 */
export async function missedNight(
  supabase: SupabaseClient,
  now: Date,
): Promise<{ lastSucceededAt: string | null } | null> {
  const { data, error } = await supabase
    .from("nightly_runs")
    .select("outcome, finished_at")
    .order("id", { ascending: false })
    .returns<{ outcome: string; finished_at: string | null }[]>();
  if (error) throw new Error(`Could not read the nightly runs: ${error.message}`);
  if (data.length === 0) return null;

  const lastSucceededAt = data.find((run) => run.outcome === "succeeded" && run.finished_at)?.finished_at ?? null;
  if (lastSucceededAt && now.getTime() - Date.parse(lastSucceededAt) <= MISSED_NIGHT_HOURS * 3_600_000) return null;
  return { lastSucceededAt };
}
