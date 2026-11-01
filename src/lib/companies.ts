import type { SupabaseClient } from "@supabase/supabase-js";
import type { Stance } from "@/lib/stances";

export type MembershipFilter = "current" | "former" | "all";

export type CompanyRow = {
  cik: string;
  name: string;
  /** One of the 11 GICS sectors, or null when no valid Sector has been found. */
  sector: string | null;
  primaryTicker: string;
  otherTickers: string[];
  membership: "current" | "former";
  history: { change: "joined" | "left"; seenOn: string }[];
  /** The newest Stance entry's Stance, or Unreviewed when there are none. */
  stance: Stance;
  onResearchList: boolean;
};

type Row = {
  cik: string;
  name: string;
  sector: string | null;
  is_current_member: boolean;
  tickers: { ticker: string; is_primary: boolean }[];
  membership_changes: { id: number; change: "joined" | "left"; seen_on: string }[];
  stance_entries: { id: number; stance: Stance; set_at: string }[];
  research_list_changes: { id: number; change: "added" | "removed"; changed_at: string }[];
};

const COLUMNS =
  "cik, name, sector, is_current_member, tickers(ticker, is_primary), membership_changes(id, change, seen_on), " +
  "stance_entries(id, stance, set_at), research_list_changes(id, change, changed_at)";

export type CompanyFilters = {
  membership: MembershipFilter;
  stance?: Stance;
  /** true for only the Companies on the Research List. */
  researchList?: boolean;
};

/** The Companies the Researcher sees, by name, with their tickers, membership history, Stance and Research List place. */
export async function listCompanies(
  supabase: SupabaseClient,
  { membership, stance, researchList }: CompanyFilters,
): Promise<CompanyRow[]> {
  let query = supabase.from("companies").select(COLUMNS).order("name");
  if (membership !== "all") query = query.eq("is_current_member", membership === "current");

  const { data, error } = await query.returns<Row[]>();
  if (error) throw new Error(`Could not read Companies: ${error.message}`);
  const companies = data.map(toCompanyRow);
  return companies.filter((c) => (!stance || c.stance === stance) && (!researchList || c.onResearchList));
}

/** One Company by its CIK, or null when the app doesn't track it. */
export async function getCompany(supabase: SupabaseClient, cik: string): Promise<CompanyRow | null> {
  const { data, error } = await supabase.from("companies").select(COLUMNS).eq("cik", cik).returns<Row[]>();
  if (error) throw new Error(`Could not read the Company: ${error.message}`);
  return data.length === 0 ? null : toCompanyRow(data[0]);
}

function toCompanyRow(row: Row): CompanyRow {
  return {
    cik: row.cik,
    name: row.name,
    sector: row.sector,
    primaryTicker: row.tickers.find((t) => t.is_primary)?.ticker ?? "",
    otherTickers: row.tickers
      .filter((t) => !t.is_primary)
      .map((t) => t.ticker)
      .sort(),
    membership: row.is_current_member ? "current" : "former",
    history: [...row.membership_changes]
      .sort((a, b) => a.seen_on.localeCompare(b.seen_on) || a.id - b.id)
      .map((c) => ({ change: c.change, seenOn: c.seen_on })),
    stance: newest(row.stance_entries, (e) => e.set_at)?.stance ?? "Unreviewed",
    onResearchList: newest(row.research_list_changes, (c) => c.changed_at)?.change === "added",
  };
}

function newest<T extends { id: number }>(entries: T[], at: (entry: T) => string): T | undefined {
  return [...entries].sort((a, b) => at(b).localeCompare(at(a)) || b.id - a.id)[0];
}
