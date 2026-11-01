import type { AiWriter } from "../../src/night/ai-writer";
import type { ConstituentSource } from "../../src/night/constituent-source";
import type { FilingsSource } from "../../src/night/filings-source";
import type { MarketDataProvider } from "../../src/night/market-data";
import { runNight } from "../../src/night/run-night";
import { constituentList, fakeConstituentSource, type FictionalCompany } from "./fake-constituent-source";
import { fakeAiWriter } from "./fake-ai-writer";
import { fakeFilingsSource } from "./fake-filings-source";
import { fakeMarketData } from "./fake-market-data";
import { adminClient, type LocalSupabase } from "./local-supabase";

export type TestNight = {
  /** The Companies in the index tonight, or a whole constituent source. */
  companies?: FictionalCompany[];
  constituents?: ConstituentSource;
  /** Defaults to a provider that knows no ticker. */
  marketData?: MarketDataProvider;
  /** Defaults to a source with no Filings. */
  filings?: FilingsSource;
  /** Defaults to a fake writer at a cent a Brief. */
  aiWriter?: AiWriter;
};

/** Runs one night against the local database, at 03:17 UTC on `date`. */
export function runTestNight(stack: LocalSupabase, date: string, night: TestNight) {
  return runNight({
    runDate: date,
    clock: { now: () => new Date(`${date}T03:17:00Z`) },
    db: adminClient(stack),
    constituents: night.constituents ?? fakeConstituentSource(constituentList(night.companies ?? [])),
    marketData: night.marketData ?? fakeMarketData(),
    filings: night.filings ?? fakeFilingsSource(),
    aiWriter: night.aiWriter ?? fakeAiWriter(),
  });
}
