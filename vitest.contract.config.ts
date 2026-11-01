import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Contract tests call the real services, so they run only on demand (`npm run test:contract`), never in CI.
// They read keys and the SEC User-Agent from .env.local.
export default defineConfig({
  test: {
    include: ["tests/contract/**/*.test.ts"],
    env: loadEnv("", process.cwd(), ""),
    fileParallelism: false,
    testTimeout: 120_000,
  },
});
