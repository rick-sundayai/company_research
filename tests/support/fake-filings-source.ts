import type { Filing, FilingsSource } from "../../src/night/filings-source";

export type FakeFilingsSource = FilingsSource & {
  /** Every CIK whose Filings were listed, in order. */
  listed: string[];
};

/** A fictional 10-K or 10-Q, with an invented accession number. */
export function fictionalFiling(cik: string, n: number, form: Filing["form"], filedOn: string): Filing {
  return {
    accession: `${cik}-26-${String(n).padStart(6, "0")}`,
    form,
    filedOn,
    reportDate: null,
    url: `https://filings.example.test/${cik}/${n}`,
  };
}

/** A Filings source for tests: each Company's Filings (newest first), each with a line of made-up text. */
export function fakeFilingsSource(filings: Record<string, Filing[]> = {}): FakeFilingsSource {
  const listed: string[] = [];
  return {
    listed,
    async list(cik) {
      listed.push(cik);
      return filings[cik] ?? [];
    },
    async text(filing) {
      return `Fictional ${filing.form} text: revenue rose and costs held steady.`;
    },
  };
}
