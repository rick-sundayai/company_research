import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";

export type LocalSupabase = {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  dbUrl: string;
  mailUrl: string;
};

/** Reads connection details from the running local Supabase stack (`npm run db:start`). */
export function readLocalSupabase(): LocalSupabase {
  let output: string;
  try {
    output = execSync("supabase status -o env", {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
  } catch {
    throw new Error("The local Supabase stack is not running. Start it with `npm run db:start`.");
  }
  const env = Object.fromEntries(
    output
      .split("\n")
      .map((line) => line.match(/^([A-Z0-9_]+)="(.*)"$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => [m[1], m[2]]),
  );
  return {
    apiUrl: env.API_URL,
    anonKey: env.ANON_KEY,
    serviceRoleKey: env.SERVICE_ROLE_KEY,
    dbUrl: env.DB_URL,
    mailUrl: env.MAILPIT_URL ?? env.INBUCKET_URL,
  };
}

/** Direct Postgres access, bypassing the API, for arranging test state and for trying what the API forbids. */
export async function withDb<T>(stack: LocalSupabase, work: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: stack.dbUrl });
  await db.connect();
  try {
    return await work(db);
  } finally {
    await db.end();
  }
}

export function adminClient(stack: LocalSupabase): SupabaseClient {
  return createClient(stack.apiUrl, stack.serviceRoleKey, { auth: { persistSession: false } });
}

export function anonClient(stack: LocalSupabase): SupabaseClient {
  return createClient(stack.apiUrl, stack.anonKey, { auth: { persistSession: false } });
}

/** Adds an email to the list of people allowed to become the Researcher. */
export async function allowResearcherEmail(stack: LocalSupabase, email: string) {
  await withDb(stack, (db) =>
    db.query("insert into private.allowed_researcher_emails (email) values ($1) on conflict do nothing", [
      email.toLowerCase(),
    ]),
  );
}

/** Removes test users (and their Researcher rows, by cascade) and their allow-list entries. Touches only the given emails. */
export async function forgetTestEmails(stack: LocalSupabase, emails: string[]) {
  if (emails.length === 0) return;
  const lowered = emails.map((e) => e.toLowerCase());
  await withDb(stack, async (db) => {
    await db.query("delete from auth.users where email = any($1)", [lowered]);
    await db.query("delete from private.allowed_researcher_emails where email = any($1)", [lowered]);
  });
}

/**
 * Empties every research table, for tests only. Companies can never be deleted (a database rule),
 * so this switches off triggers for its own session to get past that rule.
 */
export async function forgetResearchData(stack: LocalSupabase) {
  await withDb(stack, async (db) => {
    await db.query("set session_replication_role = replica");
    await db.query("delete from public.membership_changes");
    await db.query("delete from public.tickers");
    await db.query("delete from public.companies");
    await db.query("delete from public.nightly_runs");
  });
}

/** Test emails look like `label-1a2b3c4d@example.test`; the dev and e2e Researchers do not match. */
const TEST_EMAIL_PATTERN = "^[a-z0-9-]+-[0-9a-f]{8}@example\\.test$";

/** Forgets test users an aborted run left behind, older than `olderThanMinutes` so a run in progress is left alone. */
export async function sweepLeftoverTestUsers(stack: LocalSupabase, olderThanMinutes = 15): Promise<string[]> {
  const left = await withDb(stack, (db) =>
    db.query<{ email: string }>(
      `select email from auth.users
        where email ~ $1 and created_at < now() - make_interval(mins => $2)`,
      [TEST_EMAIL_PATTERN, olderThanMinutes],
    ),
  );
  const emails = left.rows.map((row) => row.email);
  await forgetTestEmails(stack, emails);
  return emails;
}

const TEST_PASSWORD = "test-password-not-a-real-secret";

/**
 * Creates a throwaway Researcher and signs them in with a client that acts as them (RLS applies).
 * The email is pushed onto `createdEmails` so the caller can forget it afterwards.
 */
export async function createTestResearcher(
  stack: LocalSupabase,
  label: string,
  createdEmails: string[],
): Promise<{ id: string; email: string; supabase: SupabaseClient }> {
  const email = uniqueTestEmail(label);
  createdEmails.push(email);
  await allowResearcherEmail(stack, email);
  const { data, error } = await adminClient(stack).auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const supabase = anonClient(stack);
  const signedIn = await supabase.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (signedIn.error) throw signedIn.error;
  return { id: data.user.id, email, supabase };
}

export function uniqueTestEmail(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`;
}

/** Dedicated Researcher for the Playwright tests, distinct from the developer's own. */
export const E2E_RESEARCHER_EMAIL = "e2e-researcher@example.test";
