/** Who is in the S&P 500 tonight, from the three free sources in ADR 0003. */
export type ConstituentList = {
  /** SPY's member rows, one per share class, with cash and futures rows already left out. */
  holdings: { ticker: string; weight: number }[];
  /** Wikipedia's Sector for each ticker, exactly as written there; it never decides membership. */
  sectors: Record<string, string | undefined>;
  /** The SEC's ticker list: share classes of one Company share a CIK (10 digits, zero-padded). */
  secTickers: Record<string, { cik: string; name: string }>;
};

export interface ConstituentSource {
  /** Throws when any of the three sources can't be read; never returns an empty list instead. */
  read(): Promise<ConstituentList>;
}
