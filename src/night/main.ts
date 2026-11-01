// The nightly job's entry point: `npm run night` (the GitHub Actions workflow runs it at 03:17 UTC).
// It runs one night against the real sources and the database named by the environment.
//
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  the database; the service role is the only writer
//   FINNHUB_API_KEY                          market data
//   GEMINI_API_KEY                           the AI writer (paid tier)
//   SEC_USER_AGENT                           who the job says it is to the SEC, Wikipedia and State Street
//   RUN_DATE                                 optional, YYYY-MM-DD; defaults to today in UTC

import { createClient } from "@supabase/supabase-js";
import { systemClock } from "./clock";
import { runNight } from "./run-night";
import { edgarFilingsSource } from "./sources/edgar";
import { finnhubProvider } from "./sources/finnhub";
import { geminiWriter } from "./sources/gemini";
import { realConstituentSource } from "./sources/real-constituent-source";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set (see .env.example).`);
  return value;
}

async function main() {
  const runDate = process.env.RUN_DATE || systemClock.now().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) throw new Error(`RUN_DATE must be YYYY-MM-DD, not "${runDate}".`);

  const db = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const constituents = realConstituentSource({ userAgent: required("SEC_USER_AGENT") });
  const filings = edgarFilingsSource({ userAgent: required("SEC_USER_AGENT") });
  const marketData = finnhubProvider({ apiKey: required("FINNHUB_API_KEY") });
  const aiWriter = geminiWriter({ apiKey: required("GEMINI_API_KEY") });

  console.log(`Running the night of ${runDate}…`);
  await runNight({ runDate, clock: systemClock, db, constituents, marketData, filings, aiWriter });
  console.log(`The night of ${runDate} finished.`);
}

main().catch((error: unknown) => {
  console.error(`The night failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
