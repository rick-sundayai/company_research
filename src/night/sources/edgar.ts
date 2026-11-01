// The Filings source on SEC EDGAR. It sends the declared User-Agent the SEC requires and makes at
// most 10 requests a second (the SEC's fair-access limit).
//
// Reply shapes (see the contract test): data.sec.gov/submissions/CIK##########.json gives
// filings.recent as parallel lists (accessionNumber, filingDate, reportDate, form, primaryDocument),
// newest first. A Filing's main document is HTML (often inline XBRL) under /Archives/edgar/data.

import type { Filing, FilingsSource } from "../filings-source";

const SUBMISSIONS = "https://data.sec.gov/submissions";
const ARCHIVES = "https://www.sec.gov/Archives/edgar/data";
const MIN_INTERVAL_MS = 110;
const TIMEOUT_MS = 60_000;
const ATTEMPTS = 3;
/** About 100k tokens: enough for the substance of a 10-K, within what a Filing summary is budgeted for. */
export const MAX_FILING_CHARS = 400_000;

export type EdgarConfig = {
  userAgent: string;
  fetch?: typeof fetch;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const decodeHtml = (text: string) =>
  text
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");

/** A Filing's HTML as plain text: no scripts, styles, hidden XBRL header or tags. */
export function filingText(html: string): string {
  const text = decodeHtml(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<ix:header\b[\s\S]*?<\/ix:header>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, MAX_FILING_CHARS);
}

export function edgarFilingsSource({
  userAgent,
  fetch: doFetch = fetch,
  clock = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: EdgarConfig): FilingsSource {
  if (!userAgent.trim()) throw new Error("SEC_USER_AGENT must be set (see .env.example).");
  let lastStartedAt: number | null = null;

  async function get(what: string, url: string): Promise<Response> {
    let problem = "";
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      if (lastStartedAt !== null) {
        const wait = lastStartedAt + MIN_INTERVAL_MS - clock();
        if (wait > 0) await sleep(wait);
      }
      lastStartedAt = clock();
      try {
        const response = await doFetch(url, { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (response.ok) return response;
        problem = `HTTP ${response.status}`;
        // Retry only what might pass next time: rate limiting and server trouble.
        if (response.status !== 429 && response.status < 500) break;
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
      }
      await sleep(1_000 * attempt);
    }
    throw new Error(`EDGAR ${what}: ${problem}`);
  }

  return {
    async list(cik) {
      const response = await get(`submissions for CIK ${cik}`, `${SUBMISSIONS}/CIK${cik.padStart(10, "0")}.json`);
      const body = (await response.json().catch(() => null)) as {
        filings?: { recent?: Record<string, unknown> };
      } | null;
      const recent = body?.filings?.recent;
      const column = (name: string) => (Array.isArray(recent?.[name]) ? (recent[name] as unknown[]) : null);
      const [accessions, dates, reports, forms, documents] = [
        "accessionNumber",
        "filingDate",
        "reportDate",
        "form",
        "primaryDocument",
      ].map(column);
      if (!accessions || !dates || !reports || !forms || !documents) {
        throw new Error(`EDGAR submissions for CIK ${cik}: unexpected reply`);
      }
      const filings: Filing[] = [];
      for (let i = 0; i < accessions.length; i++) {
        const form = forms[i];
        if (form !== "10-K" && form !== "10-Q") continue;
        const accession = String(accessions[i]);
        filings.push({
          accession,
          form,
          filedOn: String(dates[i]),
          reportDate: reports[i] ? String(reports[i]) : null,
          url: `${ARCHIVES}/${Number(cik)}/${accession.replaceAll("-", "")}/${String(documents[i])}`,
        });
      }
      return filings.sort((a, b) => b.filedOn.localeCompare(a.filedOn));
    },

    async text(filing) {
      const response = await get(`${filing.form} ${filing.accession}`, filing.url);
      return filingText(await response.text());
    },
  };
}
