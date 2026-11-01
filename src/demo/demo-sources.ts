// Fictional sources for demo mode: invented Companies, prices, Filings, news and a writer whose
// summaries quote only the Brief's own facts. Nothing here describes a real company. Tickers all
// start with ZQ, which no listed US company uses, and CIKs with 99.

import type { AiWriter, BriefRequest } from "../night/ai-writer";
import type { ConstituentList, ConstituentSource } from "../night/constituent-source";
import type { Filing, FilingsSource } from "../night/filings-source";
import { NO_METRICS, type MarketDataProvider, type Metrics, type NewsItem, type RatingCounts } from "../night/market-data";

export type DemoCompany = {
  cik: string;
  name: string;
  sector: string;
  tickers: { ticker: string; weight: number }[];
  price: number;
  marketCap: number;
  metrics: Partial<Metrics>;
};

const company = (n: number, name: string, ticker: string, sector: string, price: number, marketCap: number, metrics: Partial<Metrics>): DemoCompany => ({
  cik: `99${String(n).padStart(8, "0")}`,
  name: `${name} (fictional)`,
  sector,
  tickers: [{ ticker, weight: marketCap / 100_000 }],
  price,
  marketCap,
  metrics,
});

export const DEMO_COMPANIES: DemoCompany[] = [
  company(1, "Aurelian Kettleworks", "ZQAK", "Industrials", 84.2, 61_000, { forwardPe: 19.4, peg: 1.6, grossMargin: 34.8, operatingMargin: 14.1, revenueGrowth: 6.2, debtToEquity: 0.8 }),
  company(2, "Brindle Water Mills", "ZQBW", "Utilities", 41.6, 23_000, { forwardPe: 16.1, peg: 2.4, grossMargin: 41.2, operatingMargin: 22.5, revenueGrowth: 3.1, debtToEquity: 1.6 }),
  company(3, "Corvid Harbour Rail", "ZQCH", "Industrials", 132.9, 88_000, { forwardPe: 21.7, peg: 1.9, grossMargin: 38.4, operatingMargin: 29.3, revenueGrowth: 4.4, debtToEquity: 1.1 }),
  company(4, "Dovetail Therapeutics", "ZQDT", "Health Care", 57.3, 34_000, { forwardPe: 28.6, peg: 1.2, grossMargin: 71.5, operatingMargin: 9.8, revenueGrowth: 18.7, debtToEquity: 0.4 }),
  company(5, "Emberwick Software", "ZQES", "Information Technology", 211.4, 142_000, { forwardPe: 34.2, peg: 1.5, grossMargin: 78.9, operatingMargin: 24.6, revenueGrowth: 21.3, debtToEquity: 0.2 }),
  company(6, "Fennimore Foods", "ZQFF", "Consumer Staples", 66.8, 47_000, { forwardPe: 18.3, peg: 3.1, grossMargin: 36.7, operatingMargin: 13.2, revenueGrowth: 2.5 }),
  company(7, "Gullwing Semiconductors", "ZQGS", "Information Technology", 98.1, 76_000, { forwardPe: 26.9, peg: 1.1, grossMargin: 58.3, operatingMargin: 31.7, revenueGrowth: 27.4, debtToEquity: 0.3 }),
  company(8, "Hartsease Power", "ZQHP", "Utilities", 52.4, 29_000, { forwardPe: 15.2, peg: 2.9, grossMargin: 44.1, operatingMargin: 19.9, revenueGrowth: 2.2, debtToEquity: 1.9 }),
  company(9, "Inkwell Savings Bank", "ZQIB", "Financials", 37.9, 18_000, { forwardPe: 10.4, peg: 1.3, revenueGrowth: 5.6 }),
  company(10, "Juniper Shelf Energy", "ZQJE", "Energy", 73.5, 52_000, { forwardPe: 11.8, peg: 0.9, grossMargin: 27.3, operatingMargin: 17.4, revenueGrowth: -4.1, debtToEquity: 0.7 }),
  company(11, "Kittiwake Home Goods", "ZQKH", "Consumer Discretionary", 29.6, 12_000, { forwardPe: 22.5, peg: 2.2, grossMargin: 39.8, operatingMargin: 7.6, revenueGrowth: 3.9, debtToEquity: 1.2 }),
  company(12, "Lantern Quarry Materials", "ZQLQ", "Materials", 45.1, 15_000, { forwardPe: 17.6, peg: 2.0, grossMargin: 29.4, operatingMargin: 12.8, revenueGrowth: 1.8, debtToEquity: 0.9 }),
];

const byTicker = new Map(DEMO_COMPANIES.map((c) => [c.tickers[0].ticker, c]));
const indexOf = (c: DemoCompany) => DEMO_COMPANIES.indexOf(c);
const round2 = (n: number) => Math.round(n * 100) / 100;

export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const monthStart = (date: string, monthsBack = 0) => {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - monthsBack);
  return d.toISOString().slice(0, 10);
};

/** The demo's story, night by night: day 0 is the first night and `today` the last. */
export type DemoStory = {
  days: string[];
  /** A Company that leaves the index partway through. */
  leaver: DemoCompany;
  /** A big move on the Research List, from this day. */
  mover: DemoCompany;
  /** Earnings reported on this day. */
  reporter: DemoCompany;
  /** A new 10-Q on this day. */
  filer: DemoCompany;
  /** Off the Research List: a 12% move and an analyst shift on the last night. */
  offListMover: DemoCompany;
  offListShift: DemoCompany;
  /** Its earnings Brief is held back by the Source Check, and passes when retried the next night. */
  heldBack: DemoCompany;
};

export function demoStory(today: string, nights = 12): DemoStory {
  const days = Array.from({ length: nights }, (_, i) => addDays(today, i - nights + 1));
  const [, , c, d, e, , , , , j, k, l] = DEMO_COMPANIES;
  return { days, leaver: l, mover: c, reporter: e, filer: d, offListMover: j, offListShift: k, heldBack: e };
}

export function demoConstituents(story: DemoStory, day: string): ConstituentSource {
  const leaving = story.days.indexOf(day) >= 6;
  const list: ConstituentList = { holdings: [], sectors: {}, secTickers: {} };
  for (const c of DEMO_COMPANIES) {
    if (leaving && c === story.leaver) continue;
    for (const { ticker, weight } of c.tickers) {
      list.holdings.push({ ticker, weight });
      list.sectors[ticker] = c.sector;
      list.secTickers[ticker] = { cik: c.cik, name: c.name };
    }
  }
  return { read: async () => list };
}

function priceOn(story: DemoStory, c: DemoCompany, day: string): number {
  const i = story.days.indexOf(day);
  let price = c.price * (1 + 0.012 * Math.sin(i * 0.9 + indexOf(c)));
  if (c === story.mover && i >= 8) price *= 1.14;
  if (c === story.offListMover && i === story.days.length - 1) price *= 1.12;
  return round2(price);
}

export function demoMarketData(story: DemoStory, day: string): MarketDataProvider {
  const i = story.days.indexOf(day);
  const last = i === story.days.length - 1;
  const ratings = (c: DemoCompany): RatingCounts[] => {
    const shifted = c === story.offListShift && last;
    return [
      { period: monthStart(day), strongBuy: shifted ? 5 : 3, buy: shifted ? 4 : 3, hold: shifted ? 2 : 5, sell: 1, strongSell: 0 },
      { period: monthStart(day, 1), strongBuy: 3, buy: 3, hold: 5, sell: 1, strongSell: 0 },
    ];
  };
  const news = (c: DemoCompany): NewsItem[] =>
    indexOf(c) % 3 === 0
      ? [
          {
            headline: `${c.name.replace(" (fictional)", "")} opens a new site`,
            source: "Fictional Business Wire",
            url: `https://news.example.test/${c.tickers[0].ticker.toLowerCase()}/site`,
            publishedAt: `${addDays(day, -1)}T14:00:00Z`,
          },
        ]
      : [];
  const known = (ticker: string) => {
    const c = byTicker.get(ticker);
    if (!c) throw new Error(`The demo market data doesn't know ${ticker}`);
    return c;
  };
  return {
    async quote(ticker) {
      const c = known(ticker);
      return { price: priceOn(story, c, day), previousClose: i === 0 ? c.price : priceOn(story, c, story.days[i - 1]) };
    },
    async metrics(ticker) {
      const c = known(ticker);
      return { ...NO_METRICS, ...c.metrics, marketCap: c.marketCap };
    },
    async ratings(ticker) {
      return ratings(known(ticker));
    },
    async earningsCalendar(from, to) {
      const reportedOn = story.days[9];
      return reportedOn >= from && reportedOn <= to
        ? [{ ticker: story.reporter.tickers[0].ticker, date: reportedOn, epsActual: 1.42, epsEstimate: 1.31 }]
        : [];
    },
    async news(ticker) {
      return news(known(ticker));
    },
  };
}

export function demoFilings(story: DemoStory, day: string): FilingsSource {
  return {
    async list(cik) {
      const c = DEMO_COMPANIES.find((x) => x.cik === cik);
      if (!c) return [];
      const filing = (n: number, form: Filing["form"], filedOn: string): Filing => ({
        accession: `${cik}-26-${String(n).padStart(6, "0")}`,
        form,
        filedOn,
        reportDate: null,
        url: `https://filings.example.test/${cik}/${n}`,
      });
      const filings = [filing(2, "10-Q", addDays(story.days[0], -20)), filing(1, "10-K", addDays(story.days[0], -110))];
      if (c === story.filer && day >= story.days[6]) filings.unshift(filing(3, "10-Q", story.days[6]));
      return filings;
    },
    async text(filing) {
      return `Fictional ${filing.form}: revenue grew, costs held steady and management flagged supply risks.`;
    },
  };
}

/** The value written after a label in the facts text, e.g. "18.2" for "Forward P/E: 18.2 (Sector Median 20.1)". */
function factLine(request: BriefRequest, label: string): { value: string; median: string } | null {
  const line = request.factsText.split("\n").find((l) => l.startsWith(`${label}: `));
  const match = line && /^[^:]+: (.+?) \(Sector Median (.+?)\)/.exec(line);
  return match ? { value: match[1], median: match[2] } : null;
}

/** A writer whose summaries quote only the Brief's own facts and cite its sources. Free of charge. */
export function demoWriter(story: DemoStory, day: string): AiWriter {
  const heldBackNight = day === story.days[9];
  return {
    model: "demo-writer (fictional)",
    estimateBrief: () => 0.003,
    estimateFilingSummary: () => 0.011,
    async writeBriefs(requests) {
      return requests.map((r) => {
        const pe = factLine(r, "Forward P/E");
        const margin = factLine(r, "Operating margin");
        const filing = r.sources.find((s) => s.kind === "filing");
        const news = r.sources.find((s) => s.kind === "news");
        const lines = [
          pe && pe.value !== "not found"
            ? `Bull case: a forward P/E of ${pe.value} against a Sector Median of ${pe.median} [facts].`
            : "Bull case: no forward P/E was found [facts].",
          margin && margin.value !== "not found"
            ? `Bear case: an operating margin of ${margin.value} against a Sector Median of ${margin.median} [facts].`
            : "Bear case: no operating margin was found [facts].",
          `Open questions: what the latest filing says about costs${filing ? ` [${filing.id}]` : ""}${news ? `, and what the news means [${news.id}]` : ""}.`,
        ];
        if (heldBackNight && r.companyName === story.heldBack.name) lines[0] = "Bull case: margins near 99% [facts].";
        return { text: lines.join("\n"), usage: { inputTokens: 6200, outputTokens: 420, costUsd: 0.0005 } };
      });
    },
    async summariseFilings(requests) {
      return requests.map((r) => ({
        text: `The ${r.form} reports growing revenue and steady costs; management flags supply risks.`,
        usage: { inputTokens: 52000, outputTokens: 300, costUsd: 0.0027 },
      }));
    },
  };
}
