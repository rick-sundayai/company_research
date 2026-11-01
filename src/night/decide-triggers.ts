import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketDataProvider, RatingCounts } from "./market-data";
import {
  analystShift,
  baselineBrief,
  daysBetween,
  failuresInARow,
  MAX_FAILURES_IN_A_ROW,
  priceMove,
  ROUTINE_AFTER_DAYS,
  type PastBrief,
} from "./trigger-rules";

export type TriggerKind =
  | "earnings_reported"
  | "new_filing"
  | "price_move"
  | "analyst_shift"
  | "no_brief_yet"
  | "requested"
  | "routine";

function check<T>(result: { data: T | null; error: { message: string } | null }, doing: string): T {
  if (result.error) throw new Error(`Could not ${doing}: ${result.error.message}`);
  return result.data as T;
}

const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** The Companies on the Research List now: those whose latest change is an addition. */
export async function researchListCiks(db: SupabaseClient): Promise<Set<string>> {
  const changes = check(
    await db
      .from("research_list_changes")
      .select("cik, change")
      .order("changed_at", { ascending: true })
      .order("id", { ascending: true })
      .returns<{ cik: string; change: "added" | "removed" }[]>(),
    "read the Research List",
  );
  const latest = new Map<string, string>();
  for (const c of changes) latest.set(c.cik, c.change);
  return new Set([...latest].filter(([, change]) => change === "added").map(([cik]) => cik));
}

/**
 * Decides tonight's Triggers from tonight's snapshots, the earnings calendar and past Briefs, and
 * records them. On the Research List: requested, earnings reported, a new Filing, a price move from the baseline Brief, an
 * analyst shift, no Brief yet, and routine (only when nothing else fired). Off it: a single-day price
 * move and an analyst shift, which the Digest names but which write no Brief. News never fires one.
 */
export async function decideTriggers(db: SupabaseClient, marketData: MarketDataProvider, runId: number, runDate: string) {
  const snapshots = check(
    await db
      .from("company_snapshots")
      .select("cik, price, previous_close, ratings")
      .eq("run_id", runId)
      .returns<{ cik: string; price: number | null; previous_close: number | null; ratings: RatingCounts[] }[]>(),
    "read tonight's snapshots",
  );
  const onList = await researchListCiks(db);

  // Earnings: reports with an actual result dated since the last successful run, not seen before.
  const lastRun = check(
    await db
      .from("nightly_runs")
      .select("run_date")
      .eq("outcome", "succeeded")
      .lt("id", runId)
      .order("id", { ascending: false })
      .limit(1),
    "read the last run",
  )[0] as { run_date: string } | undefined;
  const reports = await marketData.earningsCalendar(lastRun?.run_date ?? dayBefore(runDate), runDate);
  const tickers = check(
    await db.from("tickers").select("ticker, cik").returns<{ ticker: string; cik: string }[]>(),
    "read the tickers",
  );
  const cikOf = new Map(tickers.map((t) => [t.ticker, t.cik]));
  const earlier = check(
    await db
      .from("triggers")
      .select("cik, kind, detail, nightly_runs(run_date)")
      .in("kind", ["earnings_reported", "analyst_shift"])
      .neq("run_id", runId)
      .returns<{ cik: string; kind: TriggerKind; detail: { date?: string }; nightly_runs: { run_date: string } }[]>(),
    "read earlier Triggers",
  );
  const reportedBefore = new Set(
    earlier.filter((t) => t.kind === "earnings_reported").map((t) => `${t.cik}|${t.detail.date}`),
  );
  const month = runDate.slice(0, 7);
  const shiftedThisMonth = new Set(
    earlier.filter((t) => t.kind === "analyst_shift" && t.nightly_runs.run_date.startsWith(month)).map((t) => t.cik),
  );

  // Passed Briefs set the baseline and the routine clock; held-back ones decide retries and flags.
  const pastBriefs = new Map<string, PastBrief[]>();
  const checks = new Map<
    string,
    { result: "passed" | "held_back"; triggers: { kind: TriggerKind; detail: Record<string, unknown> }[] }[]
  >();
  for (const b of check(
    await db
      .from("briefs")
      .select("cik, triggers, price, source_check, trigger_details:facts->triggers, nightly_runs(run_date)")
      .in("cik", [...onList])
      .order("id", { ascending: true })
      .returns<
        {
          cik: string;
          triggers: TriggerKind[];
          price: number | null;
          source_check: "passed" | "held_back";
          trigger_details: { kind: TriggerKind; detail: Record<string, unknown> }[] | null;
          nightly_runs: { run_date: string };
        }[]
      >(),
    "read past Briefs",
  )) {
    const triggers = b.trigger_details ?? b.triggers.map((kind) => ({ kind, detail: {} }));
    checks.set(b.cik, [...(checks.get(b.cik) ?? []), { result: b.source_check, triggers }]);
    if (b.source_check !== "passed") continue;
    pastBriefs.set(b.cik, [...(pastBriefs.get(b.cik) ?? []), { runDate: b.nightly_runs.run_date, triggers: b.triggers, price: b.price }]);
  }

  const rows: { run_id: number; cik: string; kind: TriggerKind; on_research_list: boolean; detail: object }[] = [];
  const add = (cik: string, kind: TriggerKind, detail: object) =>
    rows.push({ run_id: runId, cik, kind, on_research_list: onList.has(cik), detail });

  const checked = new Set(snapshots.map((s) => s.cik));
  const requests = check(
    await db.from("brief_requests").select("cik").is("done_run_id", null).returns<{ cik: string }[]>(),
    "read the Brief requests",
  );
  for (const { cik } of requests) {
    if (checked.has(cik) && onList.has(cik)) add(cik, "requested", {});
  }
  const newFilings = check(
    await db
      .from("filings")
      .select("cik, accession, form, filed_on")
      .eq("first_seen_run_id", runId)
      .eq("fires_trigger", true)
      .order("filed_on", { ascending: false })
      .returns<{ cik: string; accession: string; form: string; filed_on: string }[]>(),
    "read tonight's new Filings",
  );
  for (const f of newFilings) {
    if (!checked.has(f.cik) || !onList.has(f.cik) || rows.some((r) => r.cik === f.cik && r.kind === "new_filing")) continue;
    add(f.cik, "new_filing", { accession: f.accession, form: f.form, filedOn: f.filed_on });
  }
  for (const report of reports) {
    const cik = cikOf.get(report.ticker);
    if (!cik || !checked.has(cik) || !onList.has(cik) || report.epsActual === null) continue;
    if (reportedBefore.has(`${cik}|${report.date}`) || rows.some((r) => r.cik === cik && r.kind === "earnings_reported")) {
      continue;
    }
    add(cik, "earnings_reported", { date: report.date, epsActual: report.epsActual, epsEstimate: report.epsEstimate });
  }

  for (const snapshot of snapshots) {
    const briefs = pastBriefs.get(snapshot.cik) ?? [];
    if (!onList.has(snapshot.cik)) {
      const move = priceMove(snapshot.previous_close, snapshot.price);
      if (move) add(snapshot.cik, "price_move", move);
    } else {
      const baseline = baselineBrief(briefs);
      const move = baseline ? priceMove(baseline.price, snapshot.price) : null;
      if (move) add(snapshot.cik, "price_move", { ...move, since: baseline!.runDate });
    }
    const shift = shiftedThisMonth.has(snapshot.cik) ? null : analystShift(snapshot.ratings);
    if (shift) add(snapshot.cik, "analyst_shift", shift);

    if (!onList.has(snapshot.cik)) continue;
    const history = checks.get(snapshot.cik) ?? [];
    const failures = failuresInARow(history.map((h) => h.result));
    // Flagged after two held-back Briefs in a row: no retry, and no Brief from the standing Triggers
    // (no Brief yet, routine) until a new event fires one.
    if (failures >= MAX_FAILURES_IN_A_ROW) continue;
    if (failures === 1) {
      // The retry carries the held-back Brief's own Triggers, with what each found.
      for (const { kind, detail } of history.at(-1)!.triggers) {
        if (!rows.some((r) => r.cik === snapshot.cik && r.kind === kind)) add(snapshot.cik, kind, { ...detail, retry: true });
      }
    }
    const latest = briefs.at(-1);
    if (!latest) {
      if (!rows.some((r) => r.cik === snapshot.cik && r.kind === "no_brief_yet")) add(snapshot.cik, "no_brief_yet", {});
    } else if (
      daysBetween(latest.runDate, runDate) >= ROUTINE_AFTER_DAYS &&
      !rows.some((r) => r.cik === snapshot.cik)
    ) {
      add(snapshot.cik, "routine", { lastBrief: latest.runDate });
    }
  }

  if (rows.length > 0) check(await db.from("triggers").insert(rows), "record tonight's Triggers");
}
