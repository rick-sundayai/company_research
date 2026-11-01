import { describe, expect, it } from "vitest";
import {
  realConstituentSource,
  SEC_TICKERS_URL,
  SPY_HOLDINGS_URL,
  WIKIPEDIA_URL,
} from "../../src/night/sources/real-constituent-source";
import { parseSecTickers } from "../../src/night/sources/sec-tickers";
import { parseSpyHoldings } from "../../src/night/sources/spy-holdings";
import { parseWikipediaSectors } from "../../src/night/sources/wikipedia-sectors";
import { readXlsxRows } from "../../src/night/sources/xlsx";
import { validSector } from "../../src/night/sectors";

// Checks that the three real sources still have the shape the readers expect. It asserts counts and
// shapes only, never particular companies, so no real ticker is written in the code.

function userAgent(): string {
  const value = process.env.SEC_USER_AGENT;
  if (!value) throw new Error("Set SEC_USER_AGENT in .env.local to run the contract tests.");
  return value;
}

const get = (url: string) => fetch(url, { headers: { "User-Agent": userAgent() } });

describe("Constituent sources (contract)", () => {
  it("SPY's holdings file lists about 500 members whose weights add up to about 100%", async () => {
    const response = await get(SPY_HOLDINGS_URL);
    expect(response.status).toBe(200);

    const holdings = parseSpyHoldings(readXlsxRows(new Uint8Array(await response.arrayBuffer())));

    expect(holdings.length).toBeGreaterThanOrEqual(495);
    expect(holdings.length).toBeLessThanOrEqual(520);
    const total = holdings.reduce((sum, h) => sum + h.weight, 0);
    expect(total).toBeGreaterThan(95);
    expect(total).toBeLessThan(101);
  });

  it("Wikipedia's list gives a GICS Sector for about 500 tickers, nearly all of them valid", async () => {
    const response = await get(WIKIPEDIA_URL);
    expect(response.status).toBe(200);

    const sectors = Object.values(parseWikipediaSectors(await response.text()));

    expect(sectors.length).toBeGreaterThanOrEqual(495);
    const valid = sectors.filter((s) => validSector(s) !== undefined).length;
    expect(valid / sectors.length).toBeGreaterThan(0.97);
  });

  it("the SEC's ticker list maps thousands of tickers to ten-digit CIKs", async () => {
    const response = await get(SEC_TICKERS_URL);
    expect(response.status).toBe(200);

    const tickers = Object.values(parseSecTickers(await response.json()));

    expect(tickers.length).toBeGreaterThan(5000);
    expect(tickers.every((t) => /^\d{10}$/.test(t.cik))).toBe(true);
  });

  it("together, nearly every SPY member has a CIK and a Sector", async () => {
    const list = await realConstituentSource({ userAgent: userAgent() }).read();

    const tickers = list.holdings.map((h) => h.ticker);
    const withCik = tickers.filter((t) => list.secTickers[t]).length;
    const withSector = tickers.filter((t) => validSector(list.sectors[t])).length;
    expect(withCik / tickers.length).toBeGreaterThan(0.98);
    expect(withSector / tickers.length).toBeGreaterThan(0.97);
  });
});
