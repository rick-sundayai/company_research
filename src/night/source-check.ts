// The Source Check (CONTEXT.md, Company Brief): pure. Every source a Brief's summary cites must be in
// the Brief, every number it mentions must match a fact in the Brief, and it must not read as a
// recommendation, score or rating. A Brief that fails is held back with these reasons.

import type { BriefFacts } from "./brief-composer";

export type SourceCheckResult = { passed: boolean; reasons: string[] };

const CITATION = /\[([^\]\s]+)\]/g;
const NUMBER = /\$?\d[\d,]*(?:\.\d+)?%?/g;
const RECOMMENDATION =
  /\b(recommend\w*|buy rating|sell rating|hold rating|strong buy|strong sell|outperform\w*|underperform\w*|overweight|underweight|price target|top pick|undervalued|overvalued|rated? (?:it |as )?(?:a )?(?:buy|sell|hold)|(?:we|i) (?:would )?(?:buy|sell)|(?:score|rating) of)\b|\b\d+(?:\.\d+)?\s*\/\s*(?:5|10|100)\b/gi;

/** A number as written, without $, commas or %; and how many decimals it was written with. */
function parse(written: string): { value: number; decimals: number } {
  const plain = written.replace(/[$,%]/g, "");
  return { value: Number(plain), decimals: plain.includes(".") ? plain.split(".")[1].length : 0 };
}

const roundTo = (n: number, decimals: number) => Math.round(n * 10 ** decimals) / 10 ** decimals;

/** Every number the Brief holds: those in its facts text (as the writer saw them) and its raw values. */
function knownNumbers(facts: BriefFacts): number[] {
  const known: number[] = [];
  for (const match of facts.factsText.replace(CITATION, " ").matchAll(NUMBER)) known.push(parse(match[0]).value);
  const visit = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      known.push(Math.abs(value));
      // Fractions such as a 0.12 change are written as percentages.
      if (Math.abs(value) < 10) known.push(Math.abs(value) * 100);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit({ ...facts, factsText: undefined, sources: undefined, news: undefined });
  return known;
}

export function sourceCheck(summary: string, facts: BriefFacts): SourceCheckResult {
  if (summary.trim() === "") return { passed: false, reasons: ["The summary is empty."] };
  const reasons: string[] = [];

  const sourceIds = new Set(facts.sources.map((s) => s.id));
  const cited = new Set<string>();
  for (const [, id] of summary.matchAll(CITATION)) {
    if (!sourceIds.has(id) && !cited.has(id)) reasons.push(`Cites [${id}], which is not a source in the Brief.`);
    cited.add(id);
  }

  const known = knownNumbers(facts);
  const reported = new Set<string>();
  for (const match of summary.replace(CITATION, " ").matchAll(NUMBER)) {
    const { value, decimals } = parse(match[0]);
    const matches = known.some((k) => roundTo(k, decimals) === value);
    if (!matches && !reported.has(match[0])) reasons.push(`The number ${match[0]} matches no fact in the Brief.`);
    reported.add(match[0]);
  }

  for (const match of summary.matchAll(RECOMMENDATION)) {
    reasons.push(`It reads as a recommendation or rating ("${match[0]}").`);
  }

  return { passed: reasons.length === 0, reasons };
}
