import { describe, expect, it } from "vitest";
import type { BriefRequest, FilingRequest } from "../../src/night/ai-writer";
import { geminiWriter } from "../../src/night/sources/gemini";

// Replies shaped like the Gemini API's, about fictional companies.
const brief = (name: string): BriefRequest => ({
  companyName: name,
  primaryTicker: "ZZAA",
  sector: "Energy",
  triggers: ["routine"],
  factsText: "Price: $10.00 [facts]",
  sources: [{ id: "facts", kind: "facts", title: "Finnhub market data", url: null }],
});
const filing: FilingRequest = { companyName: "Fictional Co", form: "10-Q", filedOn: "2026-11-01", text: "Revenue rose." };

const answer = (text: string, input = 1000, output = 200) => ({
  candidates: [{ content: { parts: [{ text }] } }],
  usageMetadata: { promptTokenCount: input, candidatesTokenCount: output },
});

type Call = { method: string; url: string; key: string | null; body: unknown; at: number };

function fakeGemini(handle: (call: Call) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  let now = 0;
  const writer = geminiWriter({
    apiKey: "test-key-not-real",
    batchTimeLimitMs: 60_000,
    pollIntervalMs: 10_000,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const call = {
        method: init?.method ?? "GET",
        url: String(input),
        key: new Headers(init?.headers).get("x-goog-api-key"),
        body: init?.body ? JSON.parse(String(init.body)) : null,
        at: now,
      };
      calls.push(call);
      const { status = 200, body = {} } = handle(call);
      return Response.json(body, { status });
    }) as typeof fetch,
    clock: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  return { writer, calls };
}

describe("The Gemini writer", () => {
  it("sends the night's Briefs as one batch, waits for it, and returns each text with its batch-priced cost", async () => {
    let polls = 0;
    const { writer, calls } = fakeGemini((call) => {
      if (call.url.endsWith(":batchGenerateContent")) return { body: { name: "batches/abc" } };
      polls++;
      if (polls < 3) return { body: { name: "batches/abc", done: false, metadata: { state: "JOB_STATE_RUNNING" } } };
      return {
        body: {
          name: "batches/abc",
          done: true,
          metadata: { state: "JOB_STATE_SUCCEEDED" },
          response: {
            inlinedResponses: {
              inlinedResponses: [
                { response: answer("Second", 2000, 400), metadata: { key: "1" } },
                { response: answer("First"), metadata: { key: "0" } },
              ],
            },
          },
        },
      };
    });

    const results = await writer.writeBriefs([brief("Fictional One"), brief("Fictional Two")]);

    expect(results.map((r) => r.text)).toEqual(["First", "Second"]);
    // Batch price: $0.15 a million tokens in, $1.25 out.
    expect(results[0].usage).toEqual({ inputTokens: 1000, outputTokens: 200, costUsd: 0.0004 });
    const submit = calls[0];
    expect(submit.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:batchGenerateContent",
    );
    expect(submit.key).toBe("test-key-not-real");
    expect(calls.every((c) => !c.url.includes("test-key-not-real"))).toBe(true);
    const requestBody = JSON.stringify(submit.body);
    expect(requestBody).toContain('"thinkingLevel":"minimal"');
    expect(requestBody).not.toContain("thinkingBudget");
    const requests = (submit.body as { batch: { input_config: { requests: { requests: { request: { contents: { parts: { text: string }[] }[] } }[] } } } })
      .batch.input_config.requests.requests;
    expect(requests).toHaveLength(2);
    expect(requests[0].request.contents[0].parts[0].text).toContain("Fictional One");
    expect(calls.filter((c) => c.url.endsWith("/batches/abc")).map((c) => c.at)).toEqual([10_000, 20_000, 30_000]);
  });

  it("falls back to direct calls, at full price, when the batch isn't done within the time limit", async () => {
    const { writer, calls } = fakeGemini((call) => {
      if (call.url.endsWith(":batchGenerateContent")) return { body: { name: "batches/slow" } };
      if (call.url.endsWith(":cancel")) return { body: {} };
      if (call.url.endsWith(":generateContent")) return { body: answer("Direct", 1000, 200) };
      return { body: { name: "batches/slow", done: false, metadata: { state: "JOB_STATE_PENDING" } } };
    });

    const [result] = await writer.summariseFilings([filing]);

    expect(result.text).toBe("Direct");
    // Standard price: $0.30 a million tokens in, $2.50 out.
    expect(result.usage.costUsd).toBe(0.0008);
    expect(calls.some((c) => c.url.endsWith("/batches/slow:cancel"))).toBe(true);
    expect(calls.at(-1)?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
    );
  });

  it("calls directly for any request the batch couldn't answer", async () => {
    const { writer } = fakeGemini((call) => {
      if (call.url.endsWith(":batchGenerateContent")) return { body: { name: "batches/x" } };
      if (call.url.endsWith(":generateContent")) return { body: answer("Retried") };
      return {
        body: {
          done: true,
          metadata: { state: "JOB_STATE_SUCCEEDED" },
          response: {
            inlinedResponses: {
              inlinedResponses: [
                { response: answer("From batch"), metadata: { key: "0" } },
                { error: { code: 500, message: "internal" }, metadata: { key: "1" } },
              ],
            },
          },
        },
      };
    });

    const results = await writer.writeBriefs([brief("A"), brief("B")]);

    expect(results.map((r) => r.text)).toEqual(["From batch", "Retried"]);
  });

  it("estimates each call at full price, so a fallback can never take the month past the budget", () => {
    const { writer } = fakeGemini(() => ({}));

    // A Brief is budgeted for 4,096 tokens out; a Filing summary for 2,048.
    const estimate = writer.estimateBrief(brief("Fictional"));
    expect(estimate).toBeGreaterThan(4096 * 2.5e-6);
    expect(estimate).toBeLessThan(0.02);
    expect(writer.estimateFilingSummary({ ...filing, text: "x".repeat(400_000) })).toBeCloseTo(
      (100_000 + 150) * 0.3e-6 + 2048 * 2.5e-6,
      4,
    );
  });

  it("fails with a clear error when a direct call keeps failing", async () => {
    const { writer } = fakeGemini((call) => {
      if (call.url.endsWith(":batchGenerateContent")) return { status: 503, body: { error: { message: "busy" } } };
      return { status: 500, body: { error: { message: "internal" } } };
    });

    await expect(writer.writeBriefs([brief("A")])).rejects.toThrow("Gemini generateContent: HTTP 500");
  });

  it("splits a night's requests into batches small enough to send inline", async () => {
    let batches = 0;
    const { writer } = fakeGemini((call) => {
      if (call.url.endsWith(":batchGenerateContent")) {
        batches++;
        return { body: { name: `batches/${batches}` } };
      }
      const keys = call.url.endsWith("/1") ? ["0", "1", "2", "3"] : ["4", "5", "6", "7"].slice(0, 4);
      return {
        body: {
          done: true,
          metadata: { state: "JOB_STATE_SUCCEEDED" },
          response: { inlinedResponses: { inlinedResponses: keys.map((key) => ({ response: answer(`#${key}`), metadata: { key } })) } },
        },
      };
    });
    const big = { ...filing, text: "x".repeat(4_000_000) };

    const results = await writer.summariseFilings(Array.from({ length: 8 }, () => big));

    expect(batches).toBe(2);
    expect(results.map((r) => r.text)).toEqual(["#0", "#1", "#2", "#3", "#4", "#5", "#6", "#7"]);
  });
});
