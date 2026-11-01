// The Filings source (SEC EDGAR in production; a fake in tests). It lists a Company's 10-K and 10-Q
// Filings by CIK and fetches their text. It is called only for Companies on the Research List.

export type Filing = {
  /** EDGAR's accession number, e.g. 0000000000-26-000001: a Filing's identity. */
  accession: string;
  form: "10-K" | "10-Q";
  filedOn: string;
  /** The period it reports on, YYYY-MM-DD, when given. */
  reportDate: string | null;
  url: string;
};

export interface FilingsSource {
  /** The Company's 10-K and 10-Q Filings, newest first. */
  list(cik: string): Promise<Filing[]>;
  /** A Filing's text, as plain text. */
  text(filing: Filing): Promise<string>;
}
