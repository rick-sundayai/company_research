/** Fewer rows than this means the page is broken or vandalised, not that the index shrank. */
export const MIN_WIKIPEDIA_ROWS = 400;

const decodeHtml = (text: string) =>
  text
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replaceAll("&amp;", "&");

const cellText = (html: string) => decodeHtml(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();

/**
 * The GICS Sector column of Wikipedia's "List of S&P 500 companies", by ticker, exactly as written.
 * It is used only for Sectors, never for membership, and Sectors are validated by the membership update.
 */
export function parseWikipediaSectors(html: string): Record<string, string> {
  const start = html.search(/<table[^>]*\bid="constituents"/);
  if (start === -1) throw new Error("Wikipedia Sectors: no constituents table");
  const table = html.slice(start, html.indexOf("</table>", start));
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);

  const header = [...(rows[0] ?? "").matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) => cellText(m[1]));
  const symbolColumn = header.indexOf("Symbol");
  const sectorColumn = header.indexOf("GICS Sector");
  if (symbolColumn === -1 || sectorColumn === -1) throw new Error("Wikipedia Sectors: no Symbol or GICS Sector column");

  const sectors: Record<string, string> = {};
  for (const row of rows.slice(1)) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => cellText(m[1]));
    const ticker = cells[symbolColumn];
    if (ticker) sectors[ticker] = cells[sectorColumn] ?? "";
  }
  const count = Object.keys(sectors).length;
  if (count < MIN_WIKIPEDIA_ROWS) throw new Error(`Wikipedia Sectors: only ${count} rows found`);
  return sectors;
}
