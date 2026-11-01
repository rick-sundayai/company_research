// The market data provider: quotes, metrics, analyst ratings, the earnings calendar and news
// (Finnhub's free tier in production; a fake in tests). Only ticker symbols leave the app.
//
// Figures are numbers exactly as reported, or null for "not found": a missing figure is never zero.
// A provider that can't be read throws, which fails the night with a clear error.

export type Quote = {
  price: number;
  /** The previous trading day's close, for the single-day price move. */
  previousClose: number | null;
};

/**
 * The key facts and market cap. Margins and growth are percentages (45.2 means 45.2%); market cap is
 * in millions of dollars.
 */
export type Metrics = {
  marketCap: number | null;
  forwardPe: number | null;
  peg: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  revenueGrowth: number | null;
  debtToEquity: number | null;
};

/** One month's analyst rating counts; `period` is the first day of the month, YYYY-MM-01. */
export type RatingCounts = {
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
};

/** One Company's entry in the earnings calendar; `epsActual` is null until the result is reported. */
export type EarningsReport = {
  ticker: string;
  date: string;
  epsActual: number | null;
  epsEstimate: number | null;
};

export type NewsItem = {
  headline: string;
  source: string;
  url: string;
  publishedAt: string;
};

export interface MarketDataProvider {
  /** Tonight's quote, or null when the provider doesn't know the ticker. */
  quote(ticker: string): Promise<Quote | null>;
  /** The key facts; each is null when the provider has no figure. */
  metrics(ticker: string): Promise<Metrics>;
  /** Monthly analyst rating counts, newest month first. */
  ratings(ticker: string): Promise<RatingCounts[]>;
  /** Every Company's earnings reports dated from `from` to `to` (YYYY-MM-DD), in one call. */
  earningsCalendar(from: string, to: string): Promise<EarningsReport[]>;
  /** A Company's news headlines published from `from` to `to`. */
  news(ticker: string, from: string, to: string): Promise<NewsItem[]>;
}

export const NO_METRICS: Metrics = {
  marketCap: null,
  forwardPe: null,
  peg: null,
  grossMargin: null,
  operatingMargin: null,
  revenueGrowth: null,
  debtToEquity: null,
};
