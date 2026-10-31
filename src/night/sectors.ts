/** The 11 GICS sectors, the only Sector names the app accepts (CONTEXT.md › Sector). */
export const GICS_SECTORS = [
  "Communication Services",
  "Consumer Discretionary",
  "Consumer Staples",
  "Energy",
  "Financials",
  "Health Care",
  "Industrials",
  "Information Technology",
  "Materials",
  "Real Estate",
  "Utilities",
] as const;

export type Sector = (typeof GICS_SECTORS)[number];

/** The Sector if it is exactly one of the 11 names; anything else (missing, a sub-industry, a typo) is ignored. */
export function validSector(value: string | undefined): Sector | undefined {
  return GICS_SECTORS.find((sector) => sector === value?.trim());
}
