// The Research Budget planner (CONTEXT.md, Research Budget): pure. It orders the night's AI work and
// never starts a call whose estimated cost would take the month past the limit.

import type { Stance } from "../lib/stances";
import type { TriggerKind } from "./decide-triggers";

export const MONTHLY_BUDGET_USD = 10;
/** First Briefs (no Brief yet, nothing more urgent) written a night, so the first run spreads across nights. */
export const FIRST_BRIEFS_PER_NIGHT = 25;

export type Work = { name: string; triggers: TriggerKind[]; stance: Stance; marketCap: number | null };

/** 1 is first: requested, Candidate and Watching; then earnings and new Filing; then price move and analyst shift; then no Brief yet; then routine. */
export function priority({ triggers, stance }: Work): number {
  if (triggers.includes("requested") || stance === "Candidate" || stance === "Watching") return 1;
  if (triggers.includes("earnings_reported") || triggers.includes("new_filing")) return 2;
  if (triggers.includes("price_move") || triggers.includes("analyst_shift")) return 3;
  if (triggers.includes("no_brief_yet")) return 4;
  return 5;
}

/** Most important first; within a priority, the largest Companies by market cap first, then by name. */
export function orderWork<T extends Work>(work: T[]): T[] {
  return [...work].sort(
    (a, b) =>
      priority(a) - priority(b) ||
      (b.marketCap ?? -Infinity) - (a.marketCap ?? -Infinity) ||
      a.name.localeCompare(b.name),
  );
}

/** Holds back first Briefs beyond the night's share, largest Companies first. `ordered` is from `orderWork`. */
export function spreadFirstBriefs<T extends Work>(ordered: T[], perNight = FIRST_BRIEFS_PER_NIGHT): { now: T[]; later: T[] } {
  let firsts = 0;
  const now: T[] = [];
  const later: T[] = [];
  for (const item of ordered) {
    if (priority(item) === 4 && ++firsts > perNight) later.push(item);
    else now.push(item);
  }
  return { now, later };
}

/** Whether a call estimated at `cost` can start with `spent` already spent this month. */
export const fitsInBudget = (spent: number, cost: number, limit = MONTHLY_BUDGET_USD) => spent + cost <= limit + 1e-9;

/**
 * Takes work in order while the month's spend plus each call's estimate stays within the limit. The
 * first call that wouldn't fit, and everything after it, is deferred, so lower-priority work never
 * jumps ahead of higher-priority work.
 */
export function planWithinBudget<T>(
  ordered: T[],
  estimate: (item: T) => number,
  spentThisMonth: number,
  limit = MONTHLY_BUDGET_USD,
): { planned: T[]; deferred: T[] } {
  let spent = spentThisMonth;
  for (let i = 0; i < ordered.length; i++) {
    const cost = estimate(ordered[i]);
    if (!fitsInBudget(spent, cost, limit)) return { planned: ordered.slice(0, i), deferred: ordered.slice(i) };
    spent += cost;
  }
  return { planned: ordered, deferred: [] };
}
