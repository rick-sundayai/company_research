import { describe, expect, it } from "vitest";
import { edgarFilingsSource } from "../../src/night/sources/edgar";

// Replies shaped like EDGAR's, for a fictional company with invented accession numbers.
const SUBMISSIONS = {
  cik: "9900000001",
  name: "Fictional Holdings",
  filings: {
    recent: {
      accessionNumber: ["9900000001-26-000004", "9900000001-26-000003", "9900000001-26-000002", "9900000001-26-000001"],
      filingDate: ["2026-11-04", "2026-10-20", "2026-08-01", "2026-05-01"],
      reportDate: ["2026-09-30", "", "2026-06-30", "2026-03-31"],
      form: ["10-Q", "8-K", "10-K", "10-K/A"],
      primaryDocument: ["q3.htm", "news.htm", "annual.htm", "amended.htm"],
    },
  },
};

function fakeEdgar(reply: (url: string) => Response) {
  const requests: { url: string; userAgent: string | null; at: number }[] = [];
  let now = 0;
  const source = edgarFilingsSource({
    userAgent: "company_research test@example.test",
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, userAgent: new Headers(init?.headers).get("User-Agent"), at: now });
      return reply(url);
    }) as typeof fetch,
    clock: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  return { source, requests };
}

describe("The EDGAR Filings source", () => {
  it("lists a Company's 10-K and 10-Q Filings by CIK, newest first, leaving out other forms and amendments", async () => {
    const { source, requests } = fakeEdgar(() => Response.json(SUBMISSIONS));

    const filings = await source.list("9900000001");

    expect(requests[0].url).toBe("https://data.sec.gov/submissions/CIK9900000001.json");
    expect(filings).toEqual([
      {
        accession: "9900000001-26-000004",
        form: "10-Q",
        filedOn: "2026-11-04",
        reportDate: "2026-09-30",
        url: "https://www.sec.gov/Archives/edgar/data/9900000001/990000000126000004/q3.htm",
      },
      {
        accession: "9900000001-26-000002",
        form: "10-K",
        filedOn: "2026-08-01",
        reportDate: "2026-06-30",
        url: "https://www.sec.gov/Archives/edgar/data/9900000001/990000000126000002/annual.htm",
      },
    ]);
  });

  it("fetches a Filing's text without its markup, scripts or hidden XBRL header", async () => {
    const html = `<html><head><style>p{}</style><script>var x=1;</script></head><body>
      <ix:header><ix:hidden>dei:Hidden 123</ix:hidden></ix:header>
      <p>Revenue&nbsp;rose&#160;8%.</p><table><tr><td>Net&amp;income</td><td>$1,200</td></tr></table></body></html>`;
    const { source } = fakeEdgar(() => new Response(html));

    const text = await source.text({
      accession: "9900000001-26-000004",
      form: "10-Q",
      filedOn: "2026-11-04",
      reportDate: null,
      url: "https://www.sec.gov/Archives/edgar/data/9900000001/990000000126000004/q3.htm",
    });

    expect(text).toBe("Revenue rose 8%. Net&income $1,200");
  });

  it("declares who it is and makes at most 10 requests a second", async () => {
    const { source, requests } = fakeEdgar(() => Response.json(SUBMISSIONS));

    await source.list("9900000001");
    await source.list("9900000001");
    await source.list("9900000001");

    expect(requests.every((r) => r.userAgent === "company_research test@example.test")).toBe(true);
    expect(requests.map((r) => r.at)).toEqual([0, 110, 220]);
  });

  it("fails with a clear error when EDGAR can't be read", async () => {
    const { source } = fakeEdgar(() => new Response("denied", { status: 403 }));

    await expect(source.list("9900000001")).rejects.toThrow("EDGAR submissions for CIK 9900000001: HTTP 403");
  });

  it("needs a declared User-Agent", () => {
    expect(() => edgarFilingsSource({ userAgent: "" })).toThrow("SEC_USER_AGENT must be set");
  });
});
