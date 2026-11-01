// Writes .env.local from the running local Supabase stack. Never overwrites an existing file.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

if (existsSync(".env.local")) {
  console.log(".env.local already exists; leaving it alone.");
  process.exit(0);
}

const status = execSync("supabase status -o env", {
  stdio: ["ignore", "pipe", "inherit"],
}).toString();
// The dev Researcher email is defined in .env.example (and, as SQL, in supabase/seed.sql); not repeated here.
const researcherEmail = readFileSync(".env.example", "utf8").match(/^ALLOWED_RESEARCHER_EMAIL=(.+)$/m)?.[1];
if (!researcherEmail) {
  console.error("ALLOWED_RESEARCHER_EMAIL is missing from .env.example.");
  process.exit(1);
}
const value = (name) => status.match(new RegExp(`^${name}="(.*)"$`, "m"))?.[1];

writeFileSync(
  ".env.local",
  [
    `ALLOWED_RESEARCHER_EMAIL=${researcherEmail}`,
    `SUPABASE_URL=${value("API_URL")}`,
    `SUPABASE_ANON_KEY=${value("ANON_KEY")}`,
    // For `npm run night` against the local stack; add FINNHUB_API_KEY and SEC_USER_AGENT yourself.
    `SUPABASE_SERVICE_ROLE_KEY=${value("SERVICE_ROLE_KEY")}`,
    "",
  ].join("\n"),
);
console.log("Wrote .env.local for the local Supabase stack.");
