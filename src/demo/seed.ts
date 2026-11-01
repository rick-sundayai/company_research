// The demo seed: fills an empty database with fictional data by running the real night runner for
// twelve nights over the fictional sources, with Stances and Research List changes along the way.
//
//   DEMO=1 npm run demo:seed     (against the database in SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { runNight } from "../night/run-night";
import { DEMO_COMPANIES, demoConstituents, demoFilings, demoMarketData, demoStory, demoWriter } from "./demo-sources";

export { DEMO_COMPANIES } from "./demo-sources";

function check<T>(result: { data: T | null; error: { message: string } | null }, doing: string): T {
  if (result.error) throw new Error(`Could not ${doing}: ${result.error.message}`);
  return result.data as T;
}

/** Runs the demo's nights up to `today` (YYYY-MM-DD). Refuses a database that already has Companies. */
export async function seedDemo(db: SupabaseClient, { today }: { today: string }) {
  const existing = check(await db.from("companies").select("cik").limit(1), "read the Companies");
  if (existing.length > 0) throw new Error("The demo seed only fills an empty database; this one already has Companies.");

  const story = demoStory(today);
  const [aurelian, brindle, corvid, , , fennimore, gullwing, , inkwell] = DEMO_COMPANIES;
  const stance = (cik: string, stance: string, note: string, day: string) =>
    db.from("stance_entries").insert({ cik, stance, note, set_at: `${day}T12:00:00Z` }).then((r) => check(r, "set a demo Stance"));
  // Dated by the database, like the first run's additions it follows.
  const removeFromList = (cik: string) =>
    db
      .from("research_list_changes")
      .insert({ cik, change: "removed", reason: "by_hand" })
      .then((r) => check(r, "change the demo Research List"));

  for (const [i, day] of story.days.entries()) {
    const startsAt = Math.min(Date.now(), Date.parse(`${day}T03:17:00Z`));
    await runNight({
      runDate: day,
      clock: { now: () => new Date(Math.max(startsAt, Math.min(Date.now(), Date.parse(`${day}T03:47:00Z`)))) },
      db,
      constituents: demoConstituents(story, day),
      marketData: demoMarketData(story, day),
      filings: demoFilings(story, day),
      aiWriter: demoWriter(story, day),
    });

    // The Researcher's own moves between nights.
    if (i === 0) {
      await removeFromList(story.offListMover.cik);
      await removeFromList(story.offListShift.cik);
      await removeFromList(inkwell.cik);
    }
    if (i === 2) {
      await stance(aurelian.cik, "Watching", "Order book looks healthy; waiting on margins.", day);
      await stance(fennimore.cik, "Avoid", "Growth too slow for the price.", day);
    }
    if (i === 5) await stance(gullwing.cik, "Watching", "Strong growth, but the cycle worries me.", day);
    if (i === 7) await stance(aurelian.cik, "Candidate", "Margins held up in the latest filing.", day);
    if (i === 9) await stance(corvid.cik, "Watching", "Big move after the rail contract news; want to understand it.", day);
    if (i === 10) {
      await stance(brindle.cik, "Avoid", "Too much debt for a slow grower.", day);
      check(await db.from("brief_requests").insert({ cik: aurelian.cik }), "request a demo Brief");
    }
  }
}

async function main() {
  if (process.env.DEMO !== "1") throw new Error("Set DEMO=1 to seed demo data.");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example).");
  const today = new Date().toISOString().slice(0, 10);
  await seedDemo(createClient(url, key, { auth: { persistSession: false } }), { today });
  console.log(`Seeded fictional demo data for the twelve nights up to ${today}.`);
}

if (process.argv[1]?.endsWith("seed.ts")) {
  main().catch((error: unknown) => {
    console.error(`The demo seed failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
