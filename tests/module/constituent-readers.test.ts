import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { realConstituentSource } from "../../src/night/sources/real-constituent-source";
import { parseSecTickers } from "../../src/night/sources/sec-tickers";
import { parseSpyHoldings } from "../../src/night/sources/spy-holdings";
import { parseWikipediaSectors } from "../../src/night/sources/wikipedia-sectors";
import { readXlsxRows } from "../../src/night/sources/xlsx";

// Every ticker and name here is invented: ZZAAA, ZZAAB, … and "Fictional Company 1", ….
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const fictionalTicker = (i: number) =>
  `ZZ${LETTERS[Math.floor(i / 676) % 26]}${LETTERS[Math.floor(i / 26) % 26]}${LETTERS[i % 26]}`;
const many = <T,>(count: number, make: (i: number) => T) => Array.from({ length: count }, (_, i) => make(i));

const escapeXml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

/** A minimal .xlsx with one sheet: strings go in the shared-string table, numbers inline. */
function xlsx(rows: (string | number | null)[][]): Uint8Array {
  const strings: string[] = [];
  const sheetRows = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
          if (value === null) return `<c r="${ref}"/>`;
          if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
          strings.push(value);
          return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  return zipSync({
    "xl/sharedStrings.xml": strToU8(
      `<?xml version="1.0"?><sst ${ns}>${strings.map((s) => `<si><t>${escapeXml(s)}</t></si>`).join("")}</sst>`,
    ),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0"?><worksheet ${ns}><sheetData>${sheetRows}</sheetData></worksheet>`),
  });
}

const HEADER = ["Name", "Ticker", "Identifier", "SEDOL", "Weight", "Sector", "Shares Held", "Local Currency"];
const holdingRow = (i: number): (string | number)[] => [
  `FICTIONAL COMPANY ${i + 1}`,
  fictionalTicker(i),
  "000000000",
  "0000000",
  0.2,
  "-",
  1000,
  "USD",
];
const spyRows = (holdings: (string | number | null)[][]) => [
  ["Fund Name:", "A fictional fund"],
  ["Ticker Symbol:", "ZZZZ"],
  ["Holdings:", "As of 29-Oct-2026"],
  [],
  HEADER,
  ...holdings,
  [],
  ["A disclaimer paragraph."],
];

describe("Reading an .xlsx", () => {
  it("returns each row's cells in column order, with shared strings, inline numbers and blanks", () => {
    const rows = readXlsxRows(xlsx([["Name", "Weight"], ["Fictional & Co", 1.25], [null, "x"]]));

    expect(rows).toEqual([
      ["Name", "Weight"],
      ["Fictional & Co", "1.25"],
      [null, "x"],
    ]);
  });

  it("fails loudly on something that isn't a spreadsheet", () => {
    expect(() => readXlsxRows(strToU8("<html>Access denied</html>"))).toThrow("SPY holdings: not an .xlsx file");
  });
});

describe("SPY holdings", () => {
  it("returns each member's ticker and weight, ignoring the cash row, futures and placeholder rows", () => {
    const rows = spyRows([
      ...many(450, holdingRow),
      ["FICTIONAL HOLDINGS CL B", "ZZZB.B", "000000000", "0000000", 1.5, "-", 10, "USD"],
      ["US DOLLAR", "-", "-", "-", 0.06, "-", 100, "USD"],
      ["S&P500 EMINI FUT DEC26", "ESZ6", "-", "-", 0.3, "-", 1, "USD"],
      ["CONTRA FICTIONAL CVR", "1234567D", "-", "-", 0.000003, "-", 1, "USD"],
    ]);

    const holdings = parseSpyHoldings(readXlsxRows(xlsx(rows)));

    expect(holdings).toHaveLength(451);
    expect(holdings[0]).toEqual({ ticker: "ZZAAA", weight: 0.2 });
    expect(holdings.at(-1)).toEqual({ ticker: "ZZZB.B", weight: 1.5 });
  });

  it("fails loudly when the header row is missing", () => {
    const rows = spyRows(many(450, holdingRow)).filter((row) => row[0] !== "Name");

    expect(() => parseSpyHoldings(readXlsxRows(xlsx(rows)))).toThrow("SPY holdings: no header row with Ticker and Weight");
  });

  it("fails loudly instead of returning a short list", () => {
    expect(() => parseSpyHoldings(readXlsxRows(xlsx(spyRows(many(12, holdingRow)))))).toThrow(
      "SPY holdings: only 12 holdings found",
    );
  });

  it("fails loudly on a weight that isn't a number", () => {
    const rows = spyRows([...many(450, holdingRow), ["FICTIONAL", "ZZZC", "-", "-", "n/a", "-", 1, "USD"]]);

    expect(() => parseSpyHoldings(readXlsxRows(xlsx(rows)))).toThrow("SPY holdings: weight for ZZZC is not a number");
  });
});

const wikipediaPage = (rows: string[]) => `<html><body>
<table class="wikitable sortable" id="constituents"><tbody>
<tr><th><a href="#">Symbol</a></th><th>Security</th><th><a href="#">GICS</a> Sector</th><th>GICS Sub-Industry</th>
<th>Headquarters Location</th><th>Date added</th><th>CIK</th><th>Founded</th></tr>
${rows.join("\n")}
</tbody></table></body></html>`;
const wikipediaRow = (ticker: string, sector: string) =>
  `<tr><td><a rel="mw:ExtLink" href="#" class="external text">${ticker}</a></td><td><a href="#">Fictional</a></td>` +
  `<td>${sector}</td><td>Widgets</td><td>Nowhere</td><td>2001-01-01</td><td>0000000001</td><td>1900</td></tr>`;

describe("Wikipedia Sectors", () => {
  it("returns the Sector column by ticker, as written, decoding entities", () => {
    const html = wikipediaPage([
      ...many(450, (i) => wikipediaRow(fictionalTicker(i), "Industrials")),
      wikipediaRow("ZZZB.B", "Consumer Staples"),
      wikipediaRow("ZZZD", "Interactive Media &amp; Services"),
    ]);

    const sectors = parseWikipediaSectors(html);

    expect(sectors.ZZAAA).toBe("Industrials");
    expect(sectors["ZZZB.B"]).toBe("Consumer Staples");
    // Validating the Sector is the membership update's job, not the reader's.
    expect(sectors.ZZZD).toBe("Interactive Media & Services");
    expect(Object.keys(sectors)).toHaveLength(452);
  });

  it("fails loudly when the constituents table or its columns are missing", () => {
    expect(() => parseWikipediaSectors("<html><body>No table</body></html>")).toThrow(
      "Wikipedia Sectors: no constituents table",
    );
    const noSectorColumn = wikipediaPage(many(450, (i) => wikipediaRow(fictionalTicker(i), "Industrials"))).replace(
      "<a href=\"#\">GICS</a> Sector",
      "Category",
    );
    expect(() => parseWikipediaSectors(noSectorColumn)).toThrow("Wikipedia Sectors: no Symbol or GICS Sector column");
  });

  it("fails loudly instead of returning a short list", () => {
    expect(() => parseWikipediaSectors(wikipediaPage([wikipediaRow("ZZAAA", "Energy")]))).toThrow(
      "Wikipedia Sectors: only 1 rows found",
    );
  });
});

const secList = (count: number) =>
  Object.fromEntries(
    many(count, (i) => [String(i), { cik_str: 9_000_000_001 + i, ticker: fictionalTicker(i), title: `Fictional Company ${i + 1}` }]),
  );

describe("SEC tickers", () => {
  it("maps each ticker to its ten-digit CIK and name, writing share classes with a dot", () => {
    const list = { ...secList(3000), x: { cik_str: 12345, ticker: "ZZZB-B", title: "Fictional Holdings" } };

    const tickers = parseSecTickers(list);

    expect(tickers.ZZAAA).toEqual({ cik: "9000000001", name: "Fictional Company 1" });
    expect(tickers["ZZZB.B"]).toEqual({ cik: "0000012345", name: "Fictional Holdings" });
  });

  it("fails loudly on an unexpected shape or a short list", () => {
    expect(() => parseSecTickers([])).toThrow("SEC tickers: unexpected shape");
    expect(() => parseSecTickers({ 0: { ticker: "ZZAAA" } })).toThrow("SEC tickers: unexpected shape");
    expect(() => parseSecTickers(secList(10))).toThrow("SEC tickers: only 10 tickers found");
  });
});

describe("The real constituent source", () => {
  const replies = (overrides: Record<string, Response | Error> = {}) => {
    const requests: { url: string; userAgent: string | null }[] = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, userAgent: new Headers(init?.headers).get("User-Agent") });
      const key = url.includes("ssga.com") ? "spy" : url.includes("wikipedia.org") ? "wikipedia" : "sec";
      const override = overrides[key];
      if (override instanceof Error) throw override;
      if (override) return override;
      if (key === "spy") return new Response(Buffer.from(xlsx(spyRows(many(450, holdingRow)))));
      if (key === "wikipedia") return new Response(wikipediaPage(many(450, (i) => wikipediaRow(fictionalTicker(i), "Energy"))));
      return Response.json(secList(3000));
    };
    return { fetch: fetch as typeof globalThis.fetch, requests };
  };

  it("reads all three sources, declaring who it is to each", async () => {
    const { fetch, requests } = replies();

    const list = await realConstituentSource({ fetch, userAgent: "company_research test@example.test" }).read();

    expect(list.holdings).toHaveLength(450);
    expect(list.sectors.ZZAAB).toBe("Energy");
    expect(list.secTickers.ZZAAB).toEqual({ cik: "9000000002", name: "Fictional Company 2" });
    expect(requests).toHaveLength(3);
    expect(requests.every((r) => r.userAgent === "company_research test@example.test")).toBe(true);
  });

  it("fails loudly, naming the source, when one can't be read", async () => {
    const { fetch } = replies({ wikipedia: new Response("busy", { status: 503 }) });

    await expect(realConstituentSource({ fetch, userAgent: "x" }).read()).rejects.toThrow("Wikipedia Sectors: HTTP 503");
  });

  it("needs a declared User-Agent", () => {
    expect(() => realConstituentSource({ userAgent: "" })).toThrow("SEC_USER_AGENT must be set");
  });
});
