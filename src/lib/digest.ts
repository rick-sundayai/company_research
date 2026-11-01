import type { SupabaseClient } from "@supabase/supabase-js";
import type { TriggerKind } from "../night/decide-triggers";
import type { Stance } from "./stances";

/** The order Trigger groups appear in the Digest. */
export const TRIGGER_ORDER: TriggerKind[] = [
  "requested",
  "earnings_reported",
  "new_filing",
  "price_move",
  "analyst_shift",
  "no_brief_yet",
  "routine",
];

export const TRIGGER_NAMES: Record<TriggerKind, string> = {
  earnings_reported: "Earnings reported",
  new_filing: "New Filing",
  price_move: "Price move",
  analyst_shift: "Analyst shift",
  no_brief_yet: "No Brief yet",
  requested: "Requested",
  routine: "Routine",
};

export type DigestTrigger = { kind: TriggerKind; detail: Record<string, unknown> };
export type DigestCompany = {
  cik: string;
  name: string;
  primaryTicker: string;
  stance: Stance;
  triggers: DigestTrigger[];
  /** Tonight's Brief, or null when it was deferred or held back (and always null off the list). */
  brief: { id: number } | null;
  /** Whether tonight's Brief was held back by the Source Check. */
  heldBack: boolean;
};
export type Digest = {
  /** The latest finished overnight run, or null before the first. */
  run: {
    runDate: string;
    finishedAt: string;
    outcome: "succeeded" | "failed";
    membershipUpdate: "applied" | "refused" | "failed" | null;
    membershipNote: string | null;
    error: string | null;
  } | null;
  /** Companies on the Research List, grouped by Trigger; Candidate and Watching first in each group. */
  onList: { trigger: TriggerKind; companies: DigestCompany[] }[];
  /** Companies off the Research List with a price move or analyst shift. */
  offList: DigestCompany[];
  /** Companies on the Research List whose latest Brief is more than 7 days old. */
  stale: { cik: string; name: string; lastBriefOn: string }[];
  /** Companies on the Research List whose last two Briefs were held back: not retried until a new event. */
  flagged: { cik: string; name: string }[];
  briefsWritten: number;
  briefsDeferred: number;
  briefsHeldBack: number;
};

type TriggerRow = {
  kind: TriggerKind;
  on_research_list: boolean;
  detail: Record<string, unknown>;
  companies: {
    cik: string;
    name: string;
    tickers: { ticker: string; is_primary: boolean }[];
    stance_entries: { id: number; stance: Stance; set_at: string }[];
  };
};

const STANCE_ORDER: Record<Stance, number> = { Candidate: 0, Watching: 1, Unreviewed: 2, Avoid: 2 };

const byStanceThenName = (a: DigestCompany, b: DigestCompany) =>
  STANCE_ORDER[a.stance] - STANCE_ORDER[b.stance] || a.name.localeCompare(b.name);

/** The Digest: the Triggers (and, in later slices, Briefs) of the latest overnight run only. */
export async function latestDigest(supabase: SupabaseClient): Promise<Digest> {
  const runs = await supabase
    .from("nightly_runs")
    .select(
      "id, run_date, finished_at, outcome, membership_update, membership_note, error, briefs_written, briefs_deferred, briefs_held_back",
    )
    .not("finished_at", "is", null)
    .order("id", { ascending: false })
    .limit(1);
  if (runs.error) throw new Error(`Could not read the latest run: ${runs.error.message}`);
  const run = runs.data[0];
  if (!run) {
    return { run: null, onList: [], offList: [], stale: [], flagged: [], briefsWritten: 0, briefsDeferred: 0, briefsHeldBack: 0 };
  }

  const { data, error } = await supabase
    .from("triggers")
    .select(
      "kind, on_research_list, detail, companies(cik, name, tickers(ticker, is_primary), stance_entries(id, stance, set_at))",
    )
    .eq("run_id", run.id)
    .returns<TriggerRow[]>();
  if (error) throw new Error(`Could not read the Digest: ${error.message}`);
  const tonight = await supabase
    .from("briefs")
    .select("id, cik, source_check")
    .eq("run_id", run.id)
    .returns<{ id: number; cik: string; source_check: "passed" | "held_back" }[]>();
  if (tonight.error) throw new Error(`Could not read tonight's Briefs: ${tonight.error.message}`);
  const briefOf = new Map(tonight.data.filter((b) => b.source_check === "passed").map((b) => [b.cik, { id: b.id }]));
  const heldBackTonight = new Set(tonight.data.filter((b) => b.source_check === "held_back").map((b) => b.cik));

  const companies = new Map<string, DigestCompany & { onList: boolean }>();
  for (const row of data) {
    const c = row.companies;
    const latestStance = [...c.stance_entries].sort((a, b) => b.set_at.localeCompare(a.set_at) || b.id - a.id)[0];
    const entry = companies.get(c.cik) ?? {
      cik: c.cik,
      name: c.name,
      primaryTicker: c.tickers.find((t) => t.is_primary)?.ticker ?? "",
      stance: latestStance?.stance ?? "Unreviewed",
      triggers: [],
      brief: briefOf.get(c.cik) ?? null,
      heldBack: heldBackTonight.has(c.cik),
      onList: row.on_research_list,
    };
    entry.triggers.push({ kind: row.kind, detail: row.detail });
    companies.set(c.cik, entry);
  }
  for (const entry of companies.values()) {
    entry.triggers.sort((a, b) => TRIGGER_ORDER.indexOf(a.kind) - TRIGGER_ORDER.indexOf(b.kind));
  }
  const strip = ({ onList, ...company }: DigestCompany & { onList: boolean }): DigestCompany => company;
  const all = [...companies.values()];

  const { stale, flagged } = await companiesNeedingAttention(supabase, run.run_date);
  return {
    stale,
    flagged,
    briefsWritten: run.briefs_written,
    briefsDeferred: run.briefs_deferred,
    briefsHeldBack: run.briefs_held_back,
    run: {
      runDate: run.run_date,
      finishedAt: run.finished_at,
      outcome: run.outcome,
      membershipUpdate: run.membership_update,
      membershipNote: run.membership_note,
      error: run.error,
    },
    onList: TRIGGER_ORDER.map((trigger) => ({
      trigger,
      companies: all
        .filter((c) => c.onList && c.triggers.some((t) => t.kind === trigger))
        .map(strip)
        .sort(byStanceThenName),
    })).filter((group) => group.companies.length > 0),
    offList: all
      .filter((c) => !c.onList)
      .map(strip)
      .sort(byStanceThenName),
  };
}

/**
 * Companies on the Research List and in the index whose latest passed Brief is more than 7 days before
 * `runDate` (stale), or whose last two Briefs were held back (flagged).
 */
async function companiesNeedingAttention(
  supabase: SupabaseClient,
  runDate: string,
): Promise<{ stale: Digest["stale"]; flagged: Digest["flagged"] }> {
  const { data, error } = await supabase
    .from("companies")
    .select("cik, name, research_list_changes(id, change, changed_at), briefs(id, source_check, nightly_runs(run_date))")
    .eq("is_current_member", true)
    .order("name")
    .returns<
      {
        cik: string;
        name: string;
        research_list_changes: { id: number; change: string; changed_at: string }[];
        briefs: { id: number; source_check: "passed" | "held_back"; nightly_runs: { run_date: string } }[];
      }[]
    >();
  if (error) throw new Error(`Could not read the Research List: ${error.message}`);
  const stale: Digest["stale"] = [];
  const flagged: Digest["flagged"] = [];
  for (const c of data) {
    const listed = [...c.research_list_changes].sort((a, b) => b.changed_at.localeCompare(a.changed_at) || b.id - a.id)[0];
    if (listed?.change !== "added") continue;
    const briefs = [...c.briefs].sort((a, b) => b.id - a.id);
    if (briefs.length >= 2 && briefs[0].source_check === "held_back" && briefs[1].source_check === "held_back") {
      flagged.push({ cik: c.cik, name: c.name });
    }
    const latest = briefs.find((b) => b.source_check === "passed");
    if (!latest) continue;
    const age = (Date.parse(`${runDate}T00:00:00Z`) - Date.parse(`${latest.nightly_runs.run_date}T00:00:00Z`)) / 86_400_000;
    if (age > 7) stale.push({ cik: c.cik, name: c.name, lastBriefOn: latest.nightly_runs.run_date });
  }
  return { stale, flagged };
}
