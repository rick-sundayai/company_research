import type { ConstituentList, ConstituentSource } from "../../src/night/constituent-source";

/** A fictional Company as the three sources would describe it. Names and tickers are invented. */
export type FictionalCompany = {
  cik: string;
  name: string;
  /** What Wikipedia says, valid or not; leave out for a Company Wikipedia doesn't list. */
  sector?: string;
  tickers: { ticker: string; weight: number }[];
};

/** The constituent list for a night on which exactly these Companies are in the index. */
export function constituentList(companies: FictionalCompany[]): ConstituentList {
  const list: ConstituentList = { holdings: [], sectors: {}, secTickers: {} };
  for (const company of companies) {
    for (const { ticker, weight } of company.tickers) {
      list.holdings.push({ ticker, weight });
      list.sectors[ticker] = company.sector;
      list.secTickers[ticker] = { cik: company.cik, name: company.name };
    }
  }
  return list;
}

export function fakeConstituentSource(list: ConstituentList): ConstituentSource {
  return { read: async () => structuredClone(list) };
}

export function unreadableConstituentSource(message: string): ConstituentSource {
  return {
    read: async () => {
      throw new Error(message);
    },
  };
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** `count` single-class fictional Companies with tickers ZZAA, ZZAB, … and CIKs 9000000001, …. */
export function fictionalCompanies(count: number, sector = "Industrials"): FictionalCompany[] {
  return Array.from({ length: count }, (_, i) => ({
    cik: String(9_000_000_001 + i),
    name: `Fictional Company ${i + 1}`,
    sector,
    tickers: [{ ticker: `ZZ${LETTERS[Math.floor(i / 26)]}${LETTERS[i % 26]}`, weight: 0.1 }],
  }));
}

/** A fictional Company with two share classes: the B class holds the larger SPY weight. */
export const HARBOR_LANE: FictionalCompany = {
  cik: "9100000001",
  name: "Harbor Lane Holdings (fictional)",
  sector: "Communication Services",
  tickers: [
    { ticker: "ZHLA", weight: 1.2 },
    { ticker: "ZHLB", weight: 1.9 },
  ],
};

export const QUILLFEATHER: FictionalCompany = {
  cik: "9100000002",
  name: "Quillfeather Foods (fictional)",
  sector: "Consumer Staples",
  tickers: [{ ticker: "ZQLF", weight: 0.4 }],
};
