/** The Supabase connection from the environment; throws a clear message when it is not set. */
export function supabaseSettings() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set (see .env.example).");
  }
  return { url, anonKey };
}
