/** The key facts shown beside their Sector Medians, in display order (CONTEXT.md, Sector Median). */
export const KEY_FACTS = [
  { key: "forwardPe", column: "forward_pe", label: "Forward P/E", unit: "ratio" },
  { key: "peg", column: "peg", label: "PEG", unit: "ratio" },
  { key: "grossMargin", column: "gross_margin", label: "Gross margin", unit: "percent" },
  { key: "operatingMargin", column: "operating_margin", label: "Operating margin", unit: "percent" },
  { key: "revenueGrowth", column: "revenue_growth", label: "Revenue growth", unit: "percent" },
  { key: "debtToEquity", column: "debt_to_equity", label: "Debt to equity", unit: "ratio" },
] as const;

export type KeyFact = (typeof KEY_FACTS)[number];
export type FactKey = KeyFact["key"];

/** A fact's figure as shown: "18.2", "56.1%", or "not found". */
export function formatFact(value: number | null, unit: KeyFact["unit"]): string {
  if (value === null) return "not found";
  const text = value.toLocaleString("en-US", { maximumFractionDigits: unit === "percent" ? 1 : 2 });
  return unit === "percent" ? `${text}%` : text;
}
