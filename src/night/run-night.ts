import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiWriter } from "./ai-writer";
import type { Clock } from "./clock";
import type { ConstituentSource } from "./constituent-source";
import { updateIndexMembership, type MembershipResult } from "./index-membership";
import type { MarketDataProvider } from "./market-data";
import { checkFilings } from "./check-filings";
import { decideTriggers } from "./decide-triggers";
import type { FilingsSource } from "./filings-source";
import { runNightlyCheck } from "./nightly-check";
import { writeBriefs } from "./write-briefs";

export type NightDependencies = {
  /** The night being run, as YYYY-MM-DD; membership changes are dated by it. */
  runDate: string;
  clock: Clock;
  /** A service-role client: the job is the only writer of research data. */
  db: SupabaseClient;
  constituents: ConstituentSource;
  marketData: MarketDataProvider;
  filings: FilingsSource;
  aiWriter: AiWriter;
};

/**
 * Runs one night: updates Index Membership, runs the Nightly Check and Sector Medians, decides
 * Triggers, and writes Briefs within the Research Budget. A source that can't be read fails the run with a
 * clear error; a refused membership update keeps the existing members and carries on.
 */
export async function runNight({
  runDate,
  clock,
  db,
  constituents,
  marketData,
  filings,
  aiWriter,
}: NightDependencies): Promise<void> {
  const started = await db
    .from("nightly_runs")
    .insert({ run_date: runDate, started_at: clock.now().toISOString() })
    .select("id")
    .single();
  if (started.error) throw new Error(`Could not record the run: ${started.error.message}`);
  const runId: number = started.data.id;

  const finish = async (fields: Record<string, string | number | null>) => {
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

  let membership: MembershipResult | undefined;
  try {
    membership = await updateIndexMembership(db, list, runDate, runId);
    await runNightlyCheck(db, marketData, runId);
    await checkFilings(db, filings, runId);
    await decideTriggers(db, marketData, runId, runDate);
    const briefs = await writeBriefs(db, { marketData, filings, aiWriter, runId, runDate });
    await finish({
      outcome: "succeeded",
      membership_update: membership.update,
      membership_note: membership.note,
      briefs_written: briefs.written,
      briefs_deferred: briefs.deferred,
      briefs_held_back: briefs.heldBack,
    });
  } catch (error) {
    await finish({
      outcome: "failed",
      membership_update: membership?.update ?? null,
      membership_note: membership?.note ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
