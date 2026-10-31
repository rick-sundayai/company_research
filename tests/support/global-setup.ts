import { readLocalSupabase, sweepLeftoverTestUsers } from "./local-supabase";

// Runs once before the module suite: clears test users an aborted earlier run left behind.
export default async function sweepAbortedRuns() {
  await sweepLeftoverTestUsers(readLocalSupabase());
}
