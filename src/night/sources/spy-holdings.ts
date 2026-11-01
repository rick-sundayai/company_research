import type { ConstituentList } from "../constituent-source";

/** Fewer holdings than this means the file is broken, not that the index shrank. */
export const MIN_SPY_HOLDINGS = 400;

/** A stock ticker as SPY writes it: letters, with a share class after a dot (ZZZB.B). Cash ("-"), futures and placeholders don't match. */
const STOCK_TICKER = /^[A-Z]{1,5}(\.[A-Z])?$/;

/** The member tickers and weights from the rows of SPY's daily holdings file. */
export function parseSpyHoldings(rows: (string | null)[][]): ConstituentList["holdings"] {
  const headerAt = rows.findIndex((row) => row.includes("Ticker") && row.includes("Weight"));
  if (headerAt === -1) throw new Error("SPY holdings: no header row with Ticker and Weight");
  const tickerColumn = rows[headerAt].indexOf("Ticker");
  const weightColumn = rows[headerAt].indexOf("Weight");

  const holdings: ConstituentList["holdings"] = [];
  for (const row of rows.slice(headerAt + 1)) {
    const ticker = row[tickerColumn]?.trim();
    if (!ticker || !STOCK_TICKER.test(ticker)) continue;
    const weight = Number(row[weightColumn]);
    if (row[weightColumn] == null || !Number.isFinite(weight)) {
      throw new Error(`SPY holdings: weight for ${ticker} is not a number`);
    }
    holdings.push({ ticker, weight });
  }
  if (holdings.length < MIN_SPY_HOLDINGS) throw new Error(`SPY holdings: only ${holdings.length} holdings found`);
  return holdings;
}
