import type { ConstituentList } from "../constituent-source";

/** The SEC lists about 10,000 tickers; fewer than this means the file is broken. */
export const MIN_SEC_TICKERS = 1000;

/**
 * The ticker-to-CIK map from the SEC's company_tickers.json. CIKs are padded to ten digits, and share
 * classes are written with a dot (the SEC writes ZZZB-B; SPY and Wikipedia write ZZZB.B).
 */
export function parseSecTickers(json: unknown): ConstituentList["secTickers"] {
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new Error("SEC tickers: unexpected shape");
  const tickers: ConstituentList["secTickers"] = {};
  for (const entry of Object.values(json)) {
    const { cik_str, ticker, title } = (entry ?? {}) as Record<string, unknown>;
    if (typeof cik_str !== "number" || typeof ticker !== "string" || typeof title !== "string") {
      throw new Error("SEC tickers: unexpected shape");
    }
    tickers[ticker.replaceAll("-", ".")] = { cik: String(cik_str).padStart(10, "0"), name: title };
  }
  const count = Object.keys(tickers).length;
  if (count < MIN_SEC_TICKERS) throw new Error(`SEC tickers: only ${count} tickers found`);
  return tickers;
}
