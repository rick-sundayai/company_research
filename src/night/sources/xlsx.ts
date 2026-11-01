import { strFromU8, unzipSync } from "fflate";

const decodeXml = (text: string) =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replaceAll("&amp;", "&");

/** The text of every <t> inside a piece of spreadsheet XML, joined (rich text splits a string into runs). */
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join("");

/** "C12" → 2: the zero-based column of a cell reference. */
function columnOf(ref: string): number {
  let column = 0;
  for (const letter of /^[A-Z]+/.exec(ref)?.[0] ?? "") column = column * 26 + letter.charCodeAt(0) - 64;
  return column - 1;
}

/**
 * The first sheet of an .xlsx file as rows of cell text (numbers as written in the file), with null
 * for an empty cell. Enough for the SPY holdings file; it reads no formulas or dates.
 */
export function readXlsxRows(bytes: Uint8Array): (string | null)[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (file) => file.name.startsWith("xl/") });
  } catch {
    throw new Error("SPY holdings: not an .xlsx file");
  }
  const sheet = files["xl/worksheets/sheet1.xml"];
  if (!sheet) throw new Error("SPY holdings: not an .xlsx file");

  const shared = files["xl/sharedStrings.xml"];
  const strings = shared ? [...strFromU8(shared).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];

  return [...strFromU8(sheet).matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)].map((row) => {
    const cells: (string | null)[] = [];
    for (const cell of (row[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cell[1];
      const ref = /\br="([A-Z]+\d+)"/.exec(attributes)?.[1];
      const type = /\bt="(\w+)"/.exec(attributes)?.[1];
      const body = cell[2] ?? "";
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: string | null = null;
      if (type === "s" && raw !== undefined) value = strings[Number(raw)] ?? null;
      else if (type === "inlineStr") value = textOf(body);
      else if (raw !== undefined) value = decodeXml(raw);
      const column = ref ? columnOf(ref) : cells.length;
      while (cells.length < column) cells.push(null);
      cells[column] = value;
    }
    return cells;
  });
}
