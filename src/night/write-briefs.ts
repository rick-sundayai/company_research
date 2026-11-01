import type { SupabaseClient } from "@supabase/supabase-js";
import { KEY_FACTS, type FactKey } from "../lib/key-facts";
import type { Stance } from "../lib/stances";
import type { AiWriter, FilingRequest } from "./ai-writer";
import { composeBrief, type BriefFacts } from "./brief-composer";
import { fitsInBudget, orderWork, spreadFirstBriefs } from "./budget-planner";
import type { TriggerKind } from "./decide-triggers";
import type { FilingsSource } from "./filings-source";
import type { MarketDataProvider } from "./market-data";
import { sourceCheck } from "./source-check";

/** How far back a Brief's news headlines go. */
const NEWS_DAYS = 7;

function check<T>(result: { data: T | null; error: { message: string } | null }, doing: string): T {
  if (result.error) throw new Error(`Could not ${doing}: ${result.error.message}`);
  return result.data as T;
}

const daysBefore = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/** The first day of a date's month, YYYY-MM-01: the month an AI call counts against. */
export const monthOf = (date: string) => `${date.slice(0, 7)}-01`;

/** What the month's AI calls have cost so far, in dollars. */
export async function spentInMonth(db: SupabaseClient, month: string): Promise<number> {
  const rows = check(
    await db.from("ai_calls").select("cost_usd").eq("month", month).returns<{ cost_usd: number }[]>(),
    "read the budget ledger",
  );
  return rows.reduce((sum, r) => sum + Number(r.cost_usd), 0);
}

type CompanyRow = {
  cik: string;
  name: string;
  sector: string | null;
  tickers: { ticker: string; is_primary: boolean }[];
  stance_entries: { id: number; stance: Stance; set_at: string }[];
};
type SnapshotRow = Record<string, unknown> & { cik: string; ticker: string; price: number | null; market_cap: number | null };
type FilingRow = { accession: string; cik: string; form: "10-K" | "10-Q"; filed_on: string; url: string; summary: string | null };

/**
 * Writes tonight's Briefs: one for each current member on the Research List with a Trigger, most
 * important first, within the Research Budget. A Brief cites the Company's latest 10-K and 10-Q; any
 * of those not yet summarised is summarised first, once, and its cost counted with the Brief's. Each
 * AI call's real cost goes into the ledger; work that would take the month past the limit is deferred.
 */
export async function writeBriefs(
  db: SupabaseClient,
  {
    marketData,
    filings,
    aiWriter,
    runId,
    runDate,
  }: { marketData: MarketDataProvider; filings: FilingsSource; aiWriter: AiWriter; runId: number; runDate: string },
): Promise<{ written: number; deferred: number; heldBack: number }> {
  const triggerRows = check(
    await db
      .from("triggers")
      .select("cik, kind, detail")
      .eq("run_id", runId)
      .eq("on_research_list", true)
      .returns<{ cik: string; kind: TriggerKind; detail: Record<string, unknown> }[]>(),
    "read tonight's Triggers",
  );
  const triggersByCik = new Map<string, { kind: TriggerKind; detail: Record<string, unknown> }[]>();
  for (const t of triggerRows) triggersByCik.set(t.cik, [...(triggersByCik.get(t.cik) ?? []), { kind: t.kind, detail: t.detail }]);
  const ciks = [...triggersByCik.keys()];
  if (ciks.length === 0) return { written: 0, deferred: 0, heldBack: 0 };

  const [companies, snapshots, medians, previousBriefs, filingRows] = await Promise.all([
    db
      .from("companies")
      .select("cik, name, sector, tickers(ticker, is_primary), stance_entries(id, stance, set_at)")
      .in("cik", ciks)
      .returns<CompanyRow[]>()
      .then((r) => check(r, "read the Companies")),
    db
      .from("company_snapshots")
      .select("*")
      .eq("run_id", runId)
      .in("cik", ciks)
      .returns<SnapshotRow[]>()
      .then((r) => check(r, "read tonight's snapshots")),
    db
      .from("sector_medians")
      .select("sector, fact, median")
      .eq("run_id", runId)
      .returns<{ sector: string; fact: string; median: number }[]>()
      .then((r) => check(r, "read tonight's Sector Medians")),
    db
      .from("briefs")
      .select("cik, facts, nightly_runs(run_date)")
      .eq("source_check", "passed")
      .in("cik", ciks)
      .order("id", { ascending: false })
      .returns<{ cik: string; facts: BriefFacts; nightly_runs: { run_date: string } }[]>()
      .then((r) => check(r, "read the previous Briefs")),
    db
      .from("filings")
      .select("accession, cik, form, filed_on, url, summary")
      .in("cik", ciks)
      .order("filed_on", { ascending: false })
      .returns<FilingRow[]>()
      .then((r) => check(r, "read the Filings")),
  ]);
  const snapshotOf = new Map(snapshots.map((s) => [s.cik, s]));

  const work = companies.map((company) => {
    const stance = [...company.stance_entries].sort((a, b) => b.set_at.localeCompare(a.set_at) || b.id - a.id)[0];
    return {
      company,
      name: company.name,
      triggers: triggersByCik.get(company.cik)!.map((t) => t.kind),
      stance: stance?.stance ?? ("Unreviewed" as Stance),
      stanceEntry: stance,
      marketCap: snapshotOf.get(company.cik)?.market_cap ?? null,
    };
  });

  const month = monthOf(runDate);
  const { now: ordered, later: spreadOut } = spreadFirstBriefs(orderWork(work));
  const prepared = [];
  for (const item of ordered) {
    const { company, stanceEntry } = item;
    const snapshot = snapshotOf.get(company.cik);
    const ticker = company.tickers.find((t) => t.is_primary)?.ticker ?? snapshot?.ticker ?? "";
    let priceThen: number | null = null;
    if (stanceEntry) {
      const then = check(
        await db
          .from("company_snapshots")
          .select("price, nightly_runs!inner(started_at)")
          .eq("cik", company.cik)
          .lte("nightly_runs.started_at", stanceEntry.set_at)
          .order("run_id", { ascending: false })
          .limit(1)
          .returns<{ price: number | null }[]>(),
        "read the price at the Stance",
      );
      priceThen = then[0]?.price ?? null;
    }
    const previous = previousBriefs.find((b) => b.cik === company.cik);
    const facts = Object.fromEntries(KEY_FACTS.map((f) => [f.key, (snapshot?.[f.column] as number | null) ?? null])) as Record<
      FactKey,
      number | null
    >;
    const sectorMedians = Object.fromEntries(
      KEY_FACTS.flatMap((f) => {
        const m = medians.find((row) => row.sector === company.sector && row.fact === f.column);
        return m ? [[f.key, m.median]] : [];
      }),
    );
    // The latest 10-K and 10-Q, in that order; summaries already written are reused.
    const cited = (["10-K", "10-Q"] as const).flatMap((form) => {
      const latest = filingRows.find((f) => f.cik === company.cik && f.form === form);
      return latest ? [latest] : [];
    });
    // News only for Companies getting a Brief: fetched as each is planned, never for the whole index.
    const composed = (news: Awaited<ReturnType<MarketDataProvider["news"]>>, summaries: Map<string, string>) =>
      composeBrief({
        runDate,
        companyName: company.name,
        primaryTicker: ticker,
        sector: company.sector,
        triggers: triggersByCik.get(company.cik)!,
        price: snapshot?.price ?? null,
        marketCap: snapshot?.market_cap ?? null,
        facts,
        medians: sectorMedians,
        previous: previous ? { runDate: previous.nightly_runs.run_date, facts: previous.facts } : null,
        stance: stanceEntry ? { stance: stanceEntry.stance, setAt: stanceEntry.set_at, priceThen } : null,
        news,
        filings: cited.flatMap((f) => {
          const summary = f.summary ?? summaries.get(f.accession);
          return summary ? [{ accession: f.accession, form: f.form, filedOn: f.filed_on, url: f.url, summary }] : [];
        }),
      });
    prepared.push({ item, ticker, cited, composed });
  }

  // Plan in priority order, stopping at the first Company whose Filing summaries and Brief together
  // wouldn't fit. Estimates are made before news is fetched; news adds little to a Brief's cost.
  let spent = await spentInMonth(db, month);
  const planned = [];
  for (const p of prepared) {
    const pending: (FilingRequest & { accession: string })[] = [];
    for (const f of p.cited.filter((c) => c.summary === null)) {
      const text = await filings.text({ accession: f.accession, form: f.form, filedOn: f.filed_on, reportDate: null, url: f.url });
      pending.push({ accession: f.accession, companyName: p.item.name, form: f.form, filedOn: f.filed_on, text });
    }
    const placeholder = new Map(pending.map((f) => [f.accession, f.text.slice(0, 2000)]));
    const cost =
      pending.reduce((sum, f) => sum + aiWriter.estimateFilingSummary(f), 0) +
      aiWriter.estimateBrief(p.composed([], placeholder).request);
    if (!fitsInBudget(spent, cost)) break;
    spent += cost;
    planned.push({ ...p, pending });
  }
  const deferred = prepared.length - planned.length + spreadOut.length;

  // Filing summaries first: the Briefs cite them.
  const pending = planned.flatMap((p) => p.pending.map((f) => ({ ...f, cik: p.item.company.cik })));
  const summaries = new Map<string, string>();
  if (pending.length > 0) {
    const results = await aiWriter.summariseFilings(pending);
    for (const [i, f] of pending.entries()) {
      const result = results[i];
      summaries.set(f.accession, result.text);
      check(
        await db.from("ai_calls").insert({
          month,
          run_id: runId,
          cik: f.cik,
          purpose: "filing_summary",
          input_tokens: result.usage.inputTokens,
          output_tokens: result.usage.outputTokens,
          estimated_cost_usd: aiWriter.estimateFilingSummary(f),
          cost_usd: result.usage.costUsd,
        }),
        "record an AI call",
      );
      check(
        await db
          .from("filings")
          .update({ summary: result.text, summary_model: aiWriter.model, summarised_run_id: runId })
          .eq("accession", f.accession),
        "save a Filing summary",
      );
    }
  }

  const briefs = [];
  for (const p of planned) {
    const news = p.ticker ? await marketData.news(p.ticker, daysBefore(runDate, NEWS_DAYS), runDate) : [];
    briefs.push({ ...p, brief: p.composed(news, summaries) });
  }
  if (briefs.length === 0) return { written: 0, deferred, heldBack: 0 };

  const results = await aiWriter.writeBriefs(briefs.map((b) => b.brief.request));
  let heldBack = 0;
  for (const [i, b] of briefs.entries()) {
    const result = results[i];
    const cik = b.item.company.cik;
    check(
      await db.from("ai_calls").insert({
        month,
        run_id: runId,
        cik,
        purpose: "brief",
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        estimated_cost_usd: aiWriter.estimateBrief(b.brief.request),
        cost_usd: result.usage.costUsd,
      }),
      "record an AI call",
    );
    // Checked before it is saved: a Brief that fails is kept, held back, and never shown as the latest.
    const checked = sourceCheck(result.text, b.brief.facts);
    if (!checked.passed) heldBack++;
    const saved = check(
      await db.from("briefs").insert({
        run_id: runId,
        cik,
        triggers: b.item.triggers,
        price: b.brief.facts.price,
        facts: b.brief.facts,
        summary: result.text,
        model: aiWriter.model,
        source_check: checked.passed ? "passed" : "held_back",
        check_reasons: checked.reasons,
      })
      .select("id")
      .single<{ id: number }>(),
      "save a Brief",
    );
    if (checked.passed && b.item.triggers.includes("requested")) {
      check(
        await db
          .from("brief_requests")
          .update({ done_run_id: runId, done_brief_id: saved.id })
          .eq("cik", cik)
          .is("done_run_id", null),
        "mark a Brief request done",
      );
    }
  }
  return { written: briefs.length - heldBack, deferred, heldBack };
}
