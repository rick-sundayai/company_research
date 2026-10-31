import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConstituentList } from "./constituent-source";
import { validSector, type Sector } from "./sectors";

/** More removals than this in one night means the list is unreadable, not that the index changed. */
export const MAX_REMOVALS_PER_NIGHT = 10;

export type MembershipResult = { update: "applied" | "refused"; note: string | null };

type Listed = { cik: string; name: string; sector?: Sector; tickers: { ticker: string; weight: number }[] };

/** Groups tonight's holdings into Companies by CIK, leaving out tickers the SEC list doesn't know. */
function groupByCik(list: ConstituentList): { listed: Map<string, Listed>; unknown: string[] } {
  const listed = new Map<string, Listed>();
  const unknown: string[] = [];
  for (const { ticker, weight } of list.holdings) {
    const sec = list.secTickers[ticker];
    if (!sec) {
      unknown.push(ticker);
      continue;
    }
    const company = listed.get(sec.cik) ?? { cik: sec.cik, name: sec.name, tickers: [] };
    company.tickers.push({ ticker, weight });
    company.sector ??= validSector(list.sectors[ticker]);
    listed.set(sec.cik, company);
  }
  return { listed, unknown };
}

function check<T>(result: { data: T | null; error: { message: string } | null }, doing: string): T {
  if (result.error) throw new Error(`Could not ${doing}: ${result.error.message}`);
  return result.data as T;
}

/**
 * Applies tonight's constituent list: Companies join, leave and rejoin by CIK, Sectors are
 * accepted only when valid, and a list that would remove too many current members is refused.
 */
export async function updateIndexMembership(
  db: SupabaseClient,
  list: ConstituentList,
  runDate: string,
  runId: number,
): Promise<MembershipResult> {
  const { listed, unknown } = groupByCik(list);
  const note = unknown.length > 0 ? `No CIK found for: ${unknown.join(", ")}.` : null;

  const companies = check(
    await db.from("companies").select("cik, sector, is_current_member"),
    "read Companies",
  );
  const known = new Map(companies.map((c) => [c.cik, c]));
  const knownTickers = new Set(
    check(await db.from("tickers").select("ticker"), "read tickers").map((t) => t.ticker),
  );

  const leaving = companies.filter((c) => c.is_current_member && !listed.has(c.cik));
  if (leaving.length > MAX_REMOVALS_PER_NIGHT) {
    return {
      update: "refused",
      note: `The list would remove ${leaving.length} current members at once, more than the ${MAX_REMOVALS_PER_NIGHT} allowed.`,
    };
  }

  const changes: { cik: string; change: "joined" | "left"; seen_on: string; run_id: number }[] = [];

  for (const company of listed.values()) {
    const existing = known.get(company.cik);
    if (!existing) {
      check(
        await db.from("companies").insert({
          cik: company.cik,
          name: company.name,
          sector: company.sector ?? null,
          is_current_member: true,
          first_seen_on: runDate,
        }),
        `add Company ${company.cik}`,
      );
      // The primary ticker is the share class with the largest weight when first seen, and never changes.
      const primary = company.tickers.reduce((a, b) => (b.weight > a.weight ? b : a));
      check(
        await db
          .from("tickers")
          .insert(company.tickers.map(({ ticker }) => ({ ticker, cik: company.cik, is_primary: ticker === primary.ticker }))),
        `add tickers for ${company.cik}`,
      );
      changes.push({ cik: company.cik, change: "joined", seen_on: runDate, run_id: runId });
      continue;
    }

    const update: { is_current_member?: boolean; sector?: Sector } = {};
    if (!existing.is_current_member) {
      update.is_current_member = true;
      changes.push({ cik: company.cik, change: "joined", seen_on: runDate, run_id: runId });
    }
    if (company.sector && company.sector !== existing.sector) update.sector = company.sector;
    if (Object.keys(update).length > 0) {
      check(await db.from("companies").update(update).eq("cik", company.cik), `update Company ${company.cik}`);
    }

    const newTickers = company.tickers.filter(({ ticker }) => !knownTickers.has(ticker));
    if (newTickers.length > 0) {
      check(
        await db.from("tickers").insert(newTickers.map(({ ticker }) => ({ ticker, cik: company.cik }))),
        `add tickers for ${company.cik}`,
      );
    }
  }

  for (const company of leaving) {
    check(
      await db.from("companies").update({ is_current_member: false }).eq("cik", company.cik),
      `mark Company ${company.cik} as a former member`,
    );
    changes.push({ cik: company.cik, change: "left", seen_on: runDate, run_id: runId });
  }

  if (changes.length > 0) {
    check(await db.from("membership_changes").insert(changes), "record membership changes");
  }
  return { update: "applied", note };
}
