import type { ConstituentSource } from "../constituent-source";
import { parseSecTickers } from "./sec-tickers";
import { parseSpyHoldings } from "./spy-holdings";
import { parseWikipediaSectors } from "./wikipedia-sectors";
import { readXlsxRows } from "./xlsx";

// The three free sources chosen in ADR 0003.
export const SPY_HOLDINGS_URL =
  "https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx";
export const WIKIPEDIA_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies";
export const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";

const TIMEOUT_MS = 60_000;

export type RealConstituentConfig = {
  /**
   * Who is asking, e.g. "company_research <contact email>". The SEC requires a declared User-Agent
   * with a contact address; it comes from the SEC_USER_AGENT env var, never from the code.
   */
  userAgent: string;
  fetch?: typeof fetch;
};

/** Reads SPY's holdings, Wikipedia's Sectors and the SEC's tickers. Any that can't be read fails the night loudly. */
export function realConstituentSource({ userAgent, fetch: doFetch = fetch }: RealConstituentConfig): ConstituentSource {
  if (!userAgent.trim()) throw new Error("SEC_USER_AGENT must be set (see .env.example).");

  async function get(source: string, url: string): Promise<Response> {
    let response: Response;
    try {
      response = await doFetch(url, { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw new Error(`${source}: could not be fetched (${error instanceof Error ? error.message : String(error)})`);
    }
    if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
    return response;
  }

  return {
    async read() {
      const [spy, wikipedia, sec] = await Promise.all([
        get("SPY holdings", SPY_HOLDINGS_URL),
        get("Wikipedia Sectors", WIKIPEDIA_URL),
        get("SEC tickers", SEC_TICKERS_URL),
      ]);
      let secJson: unknown;
      try {
        secJson = await sec.json();
      } catch {
        throw new Error("SEC tickers: not JSON");
      }
      return {
        holdings: parseSpyHoldings(readXlsxRows(new Uint8Array(await spy.arrayBuffer()))),
        sectors: parseWikipediaSectors(await wikipedia.text()),
        secTickers: parseSecTickers(secJson),
      };
    },
  };
}
