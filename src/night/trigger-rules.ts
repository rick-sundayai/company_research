// The Trigger rules (CONTEXT.md, Trigger): pure functions of a Company's state and tonight's facts.

import type { RatingCounts } from "./market-data";

/** 10% or more either way. */
export const PRICE_MOVE_THRESHOLD = 0.1;
/** 10 percentage points or more either way. */
export const ANALYST_SHIFT_THRESHOLD = 0.1;
export const MIN_ANALYSTS = 5;

const round = (n: number) => Math.round(n * 10_000) / 10_000;

export type PriceMove = { from: number; to: number; change: number };
export type AnalystShift = { from: number; to: number; analysts: number };

/** A move of 10% or more from `from` to `to`, or null. */
export function priceMove(from: number | null, to: number | null): PriceMove | null {
  if (from === null || to === null || from <= 0) return null;
  const change = to / from - 1;
  // Compared after rounding, so a move of exactly 10% counts despite floating-point error.
  return Math.abs(round(change)) >= PRICE_MOVE_THRESHOLD ? { from, to, change: round(change) } : null;
}

const analystsIn = (r: RatingCounts) => r.strongBuy + r.buy + r.hold + r.sell + r.strongSell;
const buyShare = (r: RatingCounts) => (r.strongBuy + r.buy) / analystsIn(r);

/** The month before a YYYY-MM-01 period. */
function previousPeriod(period: string): string {
  const date = new Date(`${period}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * An analyst shift: the strong-buy-plus-buy share in the newest month against the month before, moved
 * by 10 points or more, with at least 5 analysts. Whether one already fired this month is the caller's.
 */
export function analystShift(ratings: RatingCounts[]): AnalystShift | null {
  const [current] = ratings;
  if (!current || analystsIn(current) < MIN_ANALYSTS) return null;
  const previous = ratings.find((r) => r.period === previousPeriod(current.period));
  if (!previous || analystsIn(previous) === 0) return null;
  const from = round(buyShare(previous));
  const to = round(buyShare(current));
  return Math.abs(round(to - from)) >= ANALYST_SHIFT_THRESHOLD ? { from, to, analysts: analystsIn(current) } : null;
}

/** A Company's past Brief, as the Trigger rules need it. */
export type PastBrief = { runDate: string; triggers: string[]; price: number | null };

/** A routine Brief is due when the latest Brief is this many days old. */
export const ROUTINE_AFTER_DAYS = 7;

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * The Brief a price move on the Research List is measured from: the latest one caused by a
 * non-routine Trigger, or else the first. Routine Briefs never reset it. `briefs` are oldest first.
 */
export function baselineBrief(briefs: PastBrief[]): PastBrief | null {
  const nonRoutine = briefs.filter((b) => b.triggers.some((t) => t !== "routine"));
  return nonRoutine.at(-1) ?? briefs[0] ?? null;
}

/** After this many held-back Briefs in a row, a Company's Brief is not retried and the Company is flagged. */
export const MAX_FAILURES_IN_A_ROW = 2;

/** How many of a Company's newest Briefs (oldest first in `checks`) were held back in a row. */
export function failuresInARow(checks: ("passed" | "held_back")[]): number {
  let count = 0;
  for (let i = checks.length - 1; i >= 0 && checks[i] === "held_back"; i--) count++;
  return count;
}
