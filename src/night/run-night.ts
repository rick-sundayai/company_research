import type { SupabaseClient } from "@supabase/supabase-js";
import type { Clock } from "./clock";
import type { ConstituentSource } from "./constituent-source";
import { updateIndexMembership } from "./index-membership";

export type NightDependencies = {
  /** The night being run, as YYYY-MM-DD; membership changes are dated by it. */
  runDate: string;
  clock: Clock;
  /** A service-role client: the job is the only writer of research data. */
  db: SupabaseClient;
  constituents: ConstituentSource;
};

/**
 * Runs one night: updates Index Membership, then (in later slices) the Nightly Check, Triggers,
 * Briefs and the Digest. A source that can't be read fails the run with a clear error.
 */
export async function runNight({ runDate, clock, db, constituents }: NightDependencies): Promise<void> {
  const started = await db
    .from("nightly_runs")
    .insert({ run_date: runDate, started_at: clock.now().toISOString() })
    .select("id")
    .single();
  if (started.error) throw new Error(`Could not record the run: ${started.error.message}`);
  const runId: number = started.data.id;

  const finish = async (fields: Record<string, string | null>) => {
    const { error } = await db
      .from("nightly_runs")
      .update({ ...fields, finished_at: clock.now().toISOString() })
      .eq("id", runId);
    if (error) throw new Error(`Could not record the end of the run: ${error.message}`);
  };

  let list;
  try {
    list = await constituents.read();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finish({ outcome: "failed", membership_update: "failed", error: message });
    throw error;
  }

  try {
    const membership = await updateIndexMembership(db, list, runDate, runId);
    await finish({ outcome: "succeeded", membership_update: membership.update, membership_note: membership.note });
  } catch (error) {
    await finish({ outcome: "failed", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
