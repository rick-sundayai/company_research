import { describe, expect, it } from "vitest";
import { geminiWriter } from "../../src/night/sources/gemini";

// Checks that Gemini still answers in the shape the adapter expects, through the batch and, after a
// short time limit, the direct fallback. It costs a fraction of a cent. The company is fictional.

describe("Gemini (contract)", () => {
  it("writes a Brief summary and reports its token usage and cost", async () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Set GEMINI_API_KEY in .env.local to run the contract tests.");
    const writer = geminiWriter({ apiKey, batchTimeLimitMs: 90_000, pollIntervalMs: 15_000 });

    const [result] = await writer.writeBriefs([
      {
        companyName: "Fictional Lanterns Inc.",
        primaryTicker: "ZFLN",
        sector: "Consumer Discretionary",
        triggers: ["routine"],
        factsText: "Price: $20.00 [facts]\nForward P/E: 15 (Sector Median 18) [facts]\nNews: none found",
        sources: [{ id: "facts", kind: "facts", title: "Finnhub market data", url: null }],
      },
    ]);

    expect(result.text).toMatch(/Bull case:/);
    expect(result.text).toMatch(/\[facts\]/);
    expect(result.usage.inputTokens).toBeGreaterThan(50);
    expect(result.usage.outputTokens).toBeGreaterThan(10);
    expect(result.usage.costUsd).toBeGreaterThan(0);
    expect(result.usage.costUsd).toBeLessThan(0.01);
  }, 300_000);
});
