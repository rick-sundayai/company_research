// The market data provider on Finnhub's free tier. It sends only the ticker (in the address) and the
// key (in the X-Finnhub-Token header, never the address).
//
// Reply shapes (see the contract test): /quote gives {c, pc, ...} and all zeros for an unknown symbol;
// /stock/metric gives {metric: {...}} with an empty metric for an unknown symbol, margins and growth
// as percentages and market cap in millions of dollars; /stock/recommendation gives a list of monthly
// counts; /calendar/earnings gives {earningsCalendar: [...]}; /company-news gives a list with a Unix
// `datetime`.

import { NO_METRICS, type MarketDataProvider, type Metrics, type RatingCounts } from "../market-data";

const BASE = "https://finnhub.io/api/v1";
const TIMEOUT_MS = 20_000;
// The free tier allows 60 calls a minute; one every 1.1 s stays under it.
const MIN_INTERVAL_MS = 1_100;
const ATTEMPTS = 4;
const RATE_LIMIT_WAIT_MS = 60_000;
const RETRY_WAIT_MS = 5_000;

export type FinnhubConfig = {
  apiKey: string;
  fetch?: typeof fetch;
  /** Injectable for tests. */
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** A finite JSON number, or null; zero and negatives are real figures (a loss-making margin, flat growth). */
const figure = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
/** A positive JSON number, or null: a price, market cap or multiple of zero means "none". */
const positive = (value: unknown): number | null => {
  const n = figure(value);
  return n !== null && n > 0 ? n : null;
};
const count = (value: unknown): number => (typeof value === "number" && value >= 0 ? value : 0);

class UnexpectedReply extends Error {}

export function finnhubProvider({
  apiKey,
  fetch: doFetch = fetch,
  clock = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: FinnhubConfig): MarketDataProvider {
  if (!apiKey) throw new Error("FINNHUB_API_KEY must be set (see .env.example).");
  let lastStartedAt: number | null = null;

  /** One GET, paced and retried. `what` names it in errors, e.g. "quote for ZZAA". */
  async function get(what: string, path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(BASE + path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    let problem = "";
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      if (lastStartedAt !== null) {
        const wait = lastStartedAt + MIN_INTERVAL_MS - clock();
        if (wait > 0) await sleep(wait);
      }
      lastStartedAt = clock();

      let response: Response;
      try {
        response = await doFetch(url, { headers: { "X-Finnhub-Token": apiKey }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
        await sleep(RETRY_WAIT_MS * attempt);
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Finnhub ${what}: HTTP ${response.status} (check FINNHUB_API_KEY)`);
      }
      if (response.status === 429) {
        problem = "HTTP 429";
        await sleep(RATE_LIMIT_WAIT_MS);
        continue;
      }
      if (!response.ok) {
        problem = `HTTP ${response.status}`;
        await sleep(RETRY_WAIT_MS * attempt);
        continue;
      }
      try {
        return await response.json();
      } catch {
        throw new Error(`Finnhub ${what}: unexpected reply`);
      }
    }
    throw new Error(`Finnhub ${what}: ${problem}`);
  }

  async function read<T>(what: string, path: string, params: Record<string, string>, parse: (body: unknown) => T) {
    const body = await get(what, path, params);
    try {
      return parse(body);
    } catch (error) {
      if (error instanceof UnexpectedReply) throw new Error(`Finnhub ${what}: unexpected reply`);
      throw error;
    }
  }

  const expectObject = (body: unknown): Json => {
    if (!isObject(body)) throw new UnexpectedReply();
    return body;
  };
  const expectList = (body: unknown): unknown[] => {
    if (!Array.isArray(body)) throw new UnexpectedReply();
    return body;
  };

  return {
    quote: (ticker) =>
      read(`quote for ${ticker}`, "/quote", { symbol: ticker }, (body) => {
        const { c, pc } = expectObject(body);
        const price = positive(c);
        return price === null ? null : { price, previousClose: positive(pc) };
      }),

    metrics: (ticker) =>
      read(`metrics for ${ticker}`, "/stock/metric", { symbol: ticker, metric: "all" }, (body): Metrics => {
        const metric = expectObject(body).metric;
        if (!isObject(metric)) throw new UnexpectedReply();
        if (Object.keys(metric).length === 0) return NO_METRICS;
        return {
          marketCap: positive(metric.marketCapitalization),
          forwardPe: positive(metric.forwardPE),
          peg: positive(metric.forwardPEG),
          grossMargin: figure(metric.grossMarginTTM),
          operatingMargin: figure(metric.operatingMarginTTM),
          revenueGrowth: figure(metric.revenueGrowthTTMYoy),
          debtToEquity: figure(metric["totalDebt/totalEquityQuarterly"]),
        };
      }),

    ratings: (ticker) =>
      read(`ratings for ${ticker}`, "/stock/recommendation", { symbol: ticker }, (body) =>
        expectList(body)
          .filter(isObject)
          .filter((r) => typeof r.period === "string")
          .map(
            (r): RatingCounts => ({
              period: r.period as string,
              strongBuy: count(r.strongBuy),
              buy: count(r.buy),
              hold: count(r.hold),
              sell: count(r.sell),
              strongSell: count(r.strongSell),
            }),
          )
          .sort((a, b) => b.period.localeCompare(a.period)),
      ),

    earningsCalendar: (from, to) =>
      read(`earnings calendar ${from} to ${to}`, "/calendar/earnings", { from, to }, (body) => {
        const calendar = expectObject(body).earningsCalendar;
        return expectList(calendar)
          .filter(isObject)
          .filter((e) => typeof e.symbol === "string" && typeof e.date === "string")
          .map((e) => ({
            ticker: e.symbol as string,
            date: e.date as string,
            epsActual: figure(e.epsActual),
            epsEstimate: figure(e.epsEstimate),
          }));
      }),

    news: (ticker, from, to) =>
      read(`news for ${ticker}`, "/company-news", { symbol: ticker, from, to }, (body) =>
        expectList(body)
          .filter(isObject)
          .filter((n) => typeof n.headline === "string" && typeof n.url === "string" && typeof n.datetime === "number")
          .map((n) => ({
            headline: n.headline as string,
            source: typeof n.source === "string" ? n.source : "",
            url: n.url as string,
            publishedAt: new Date((n.datetime as number) * 1000).toISOString(),
          })),
      ),
  };
}
