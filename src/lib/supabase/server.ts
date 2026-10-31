import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseSettings } from "./settings";

export async function createSupabaseServerClient() {
  const { url, anonKey } = supabaseSettings();
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, which cannot set cookies; the proxy refreshes the session.
        }
      },
    },
  });
}
