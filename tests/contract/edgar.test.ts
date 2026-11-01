import { describe, expect, it } from "vitest";
import { edgarFilingsSource } from "../../src/night/sources/edgar";
import { SEC_TICKERS_URL } from "../../src/night/sources/real-constituent-source";
import { parseSecTickers } from "../../src/night/sources/sec-tickers";

// Checks that EDGAR still returns what the adapter expects. The company is the first one in the SEC's
// own ticker list, taken at run time, so no real company is written in the code.

describe("EDGAR (contract)", () => {
  it("lists a large company's 10-K and 10-Q Filings and returns a Filing's text", async () => {
    const userAgent = process.env.SEC_USER_AGENT;
    if (!userAgent) throw new Error("Set SEC_USER_AGENT in .env.local to run the contract tests.");
    const tickers = parseSecTickers(await (await fetch(SEC_TICKERS_URL, { headers: { "User-Agent": userAgent } })).json());
    const { cik } = Object.values(tickers)[0];
    const source = edgarFilingsSource({ userAgent });

    const filings = await source.list(cik);

    expect(filings.some((f) => f.form === "10-K")).toBe(true);
    expect(filings.some((f) => f.form === "10-Q")).toBe(true);
    expect(filings[0].filedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const text = await source.text(filings.find((f) => f.form === "10-Q")!);
    expect(text.length).toBeGreaterThan(10_000);
    expect(text).not.toMatch(/<\/?(div|span|td)\b/);
  });
});
