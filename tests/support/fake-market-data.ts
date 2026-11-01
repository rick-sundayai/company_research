import {
  NO_METRICS,
  type EarningsReport,
  type MarketDataProvider,
  type Metrics,
  type NewsItem,
  type Quote,
  type RatingCounts,
} from "../../src/night/market-data";

/** What the fake provider knows about one ticker. Anything left out is "not found". */
export type FakeTicker = {
  quote?: Quote;
  metrics?: Partial<Metrics>;
  ratings?: RatingCounts[];
  news?: NewsItem[];
};

export type FakeMarketData = MarketDataProvider & {
  /** Every ticker asked for a quote, in order. */
  quoted: string[];
};

/** A market data provider for tests, answering from fictional figures. */
export function fakeMarketData(
  tickers: Record<string, FakeTicker> = {},
  earnings: EarningsReport[] = [],
): FakeMarketData {
  const quoted: string[] = [];
  return {
    quoted,
    async quote(ticker) {
      quoted.push(ticker);
      return tickers[ticker]?.quote ?? null;
    },
    async metrics(ticker) {
      return { ...NO_METRICS, ...tickers[ticker]?.metrics };
    },
    async ratings(ticker) {
      return tickers[ticker]?.ratings ?? [];
    },
    async earningsCalendar(from, to) {
      return earnings.filter((e) => e.date >= from && e.date <= to);
    },
    async news(ticker) {
      return tickers[ticker]?.news ?? [];
    },
  };
}

/** A provider that can't be read at all. */
export function unreadableMarketData(message: string): MarketDataProvider {
  const fail = async (): Promise<never> => {
    throw new Error(message);
  };
  return { quote: fail, metrics: fail, ratings: fail, earningsCalendar: fail, news: fail };
}
