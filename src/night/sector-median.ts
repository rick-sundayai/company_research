import type { FactKey } from "../lib/key-facts";
import { KEY_FACTS } from "../lib/key-facts";
import type { Sector } from "./sectors";

export type SectorMedian = { sector: Sector; fact: FactKey; median: number; companies: number };

/** The middle figure; with an even count, the average of the two middle figures. */
export function median(figures: number[]): number {
  const sorted = [...figures].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The median of each key fact in each Sector, across the Companies given (the current members).
 * A Company without a valid Sector, or without a figure for a fact, is left out of that median.
 */
export function sectorMedians(
  companies: { sector: Sector | null; facts: Record<FactKey, number | null> }[],
): SectorMedian[] {
  const figures = new Map<string, { sector: Sector; fact: FactKey; values: number[] }>();
  for (const company of companies) {
    if (!company.sector) continue;
    for (const { key } of KEY_FACTS) {
      const value = company.facts[key];
      if (value === null) continue;
      const id = `${company.sector}|${key}`;
      const entry = figures.get(id) ?? { sector: company.sector, fact: key, values: [] };
      entry.values.push(value);
      figures.set(id, entry);
    }
  }
  return [...figures.values()].map(({ sector, fact, values }) => ({
    sector,
    fact,
    median: median(values),
    companies: values.length,
  }));
}
