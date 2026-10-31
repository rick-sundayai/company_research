import type { SupabaseClient } from "@supabase/supabase-js";

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
};

type Row = {
  cik: string;
  name: string;
  sector: string | null;
  is_current_member: boolean;
  tickers: { ticker: string; is_primary: boolean }[];
  membership_changes: { id: number; change: "joined" | "left"; seen_on: string }[];
};

/** The Companies the Researcher sees, by name, with their tickers and membership history. */
export async function listCompanies(
  supabase: SupabaseClient,
  { membership }: { membership: MembershipFilter },
): Promise<CompanyRow[]> {
  let query = supabase
    .from("companies")
    .select("cik, name, sector, is_current_member, tickers(ticker, is_primary), membership_changes(id, change, seen_on)")
    .order("name");
  if (membership !== "all") query = query.eq("is_current_member", membership === "current");

  const { data, error } = await query.returns<Row[]>();
  if (error) throw new Error(`Could not read Companies: ${error.message}`);

  return data.map((row) => ({
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
  }));
}
