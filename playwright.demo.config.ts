import { defineConfig } from "@playwright/test";
import { E2E_RESEARCHER_EMAIL, readLocalSupabase } from "./tests/support/local-supabase";

const stack = readLocalSupabase();

// The app in demo mode (DEMO=1), for the test that every page carries the fictional-data label.
export default defineConfig({
  testDir: "tests/e2e-demo",
  workers: 1,
  use: { baseURL: "http://localhost:3200" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3200/sign-in",
    reuseExistingServer: false,
    env: {
      DEMO: "1",
      ALLOWED_RESEARCHER_EMAIL: E2E_RESEARCHER_EMAIL,
      SUPABASE_URL: stack.apiUrl,
      SUPABASE_ANON_KEY: stack.anonKey,
    },
  },
});
