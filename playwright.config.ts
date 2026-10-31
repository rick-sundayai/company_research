import { defineConfig } from "@playwright/test";
import { E2E_RESEARCHER_EMAIL, readLocalSupabase } from "./tests/support/local-supabase";

const stack = readLocalSupabase();

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://localhost:3200" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3200/sign-in",
    reuseExistingServer: false,
    env: {
      ALLOWED_RESEARCHER_EMAIL: E2E_RESEARCHER_EMAIL,
      SUPABASE_URL: stack.apiUrl,
      SUPABASE_ANON_KEY: stack.anonKey,
    },
  },
});
