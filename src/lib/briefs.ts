import type { SupabaseClient } from "@supabase/supabase-js";
import type { BriefFacts } from "../night/brief-composer";
import { MONTHLY_BUDGET_USD } from "../night/budget-planner";
import type { TriggerKind } from "../night/decide-triggers";

export type Brief = {
  id: number;
  cik: string;
  runDate: string;
  writtenAt: string;
  triggers: TriggerKind[];
  price: number | null;
  facts: BriefFacts;
  summary: string;
  model: string;
  /** Shown with every summary. */
  notice: string;
};

type BriefRow = {
  id: number;
  cik: string;
  written_at: string;
  triggers: TriggerKind[];
  price: number | null;
  facts: BriefFacts;
  summary: string;
  model: string;
  nightly_runs: { run_date: string };
};

const COLUMNS = "id, cik, written_at, triggers, price, facts, summary, model, nightly_runs(run_date)";

export const machineWrittenNotice = (model: string) =>
  `This summary is machine-written by ${model} from the facts and sources in this Brief only. It may be wrong: check it against them.`;

const toBrief = (row: BriefRow): Brief => ({
  id: row.id,
  cik: row.cik,
  runDate: row.nightly_runs.run_date,
  writtenAt: row.written_at,
  triggers: row.triggers,
  price: row.price,
  facts: row.facts,
  summary: row.summary,
  model: row.model,
  notice: machineWrittenNotice(row.model),
});

/** Every Brief for a Company that passed the Source Check, newest first. */
export async function briefHistory(supabase: SupabaseClient, cik: string): Promise<Brief[]> {
  const { data, error } = await supabase
    .from("briefs")
    .select(COLUMNS)
    .eq("cik", cik)
    .eq("source_check", "passed")
    .order("id", { ascending: false })
    .returns<BriefRow[]>();
  if (error) throw new Error(`Could not read the Briefs: ${error.message}`);
  return data.map(toBrief);
}

/** A Company's latest Brief that passed the Source Check, or null when it has none. */
export async function latestBrief(supabase: SupabaseClient, cik: string): Promise<Brief | null> {
  return (await briefHistory(supabase, cik))[0] ?? null;
}

/** One Brief that passed the Source Check, by its id, or null. */
export async function getBrief(supabase: SupabaseClient, id: number): Promise<Brief | null> {
  const { data, error } = await supabase
    .from("briefs")
    .select(COLUMNS)
    .eq("id", id)
    .eq("source_check", "passed")
    .returns<BriefRow[]>();
  if (error) throw new Error(`Could not read the Brief: ${error.message}`);
  return data[0] ? toBrief(data[0]) : null;
}

export type HeldBackBrief = Brief & { reasons: string[] };

/** A Company's Briefs that the Source Check held back, newest first, with its reasons. */
export async function heldBackBriefs(supabase: SupabaseClient, cik: string): Promise<HeldBackBrief[]> {
  const { data, error } = await supabase
    .from("briefs")
    .select(`${COLUMNS}, check_reasons`)
    .eq("cik", cik)
    .eq("source_check", "held_back")
    .order("id", { ascending: false })
    .returns<(BriefRow & { check_reasons: string[] })[]>();
  if (error) throw new Error(`Could not read the held-back Briefs: ${error.message}`);
  return data.map((row) => ({ ...toBrief(row), reasons: row.check_reasons }));
}

/** The month's AI spend and what's left of the Research Budget, for the month containing `date`. */
export async function researchBudget(
  supabase: SupabaseClient,
  date: string,
): Promise<{ spent: number; limit: number; left: number }> {
  const { data, error } = await supabase
    .from("ai_calls")
    .select("cost_usd")
    .eq("month", `${date.slice(0, 7)}-01`)
    .returns<{ cost_usd: number }[]>();
  if (error) throw new Error(`Could not read the budget ledger: ${error.message}`);
  const spent = Math.round(data.reduce((sum, r) => sum + Number(r.cost_usd), 0) * 1_000_000) / 1_000_000;
  return { spent, limit: MONTHLY_BUDGET_USD, left: Math.max(0, Math.round((MONTHLY_BUDGET_USD - spent) * 1_000_000) / 1_000_000) };
}
