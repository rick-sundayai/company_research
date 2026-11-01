// The AI writer on Gemini 2.5 Flash-Lite, paid tier (content isn't used to improve Google's products).
// Each night's requests go in as a batch at half price; if the batch hasn't finished within the time
// limit, or leaves a request unanswered, those requests are made directly at full price so the Digest
// stays on time. Every result carries its real token usage and cost.
//
// API shapes (see the contract test and https://ai.google.dev/gemini-api/docs/batch-mode): POST
// models/{model}:batchGenerateContent with inline requests returns {name: "batches/…"}; GET that name
// until done, then response.inlinedResponses holds each {response | error, metadata: {key}}.

import type { AiResult, AiWriter, BriefRequest, FilingRequest } from "../ai-writer";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_MODEL = "gemini-2.5-flash-lite";

// Dollars per token on the paid tier (checked 2026-10-31): standard, and batch at half that.
const PRICE = {
  standard: { input: 0.1e-6, output: 0.4e-6 },
  batch: { input: 0.05e-6, output: 0.2e-6 },
};
const BRIEF_MAX_OUTPUT = 4096;
const FILING_MAX_OUTPUT = 2048;
/** Inline batch requests must stay under 20 MB; this leaves room for the envelope. */
const MAX_BATCH_BYTES = 18_000_000;
const DIRECT_ATTEMPTS = 3;
const TIMEOUT_MS = 120_000;

const BRIEF_INSTRUCTIONS = `You write the summary of a research Brief on one company for a private investor.
Use only the facts and sources in the message: no general knowledge and nothing from the web.
Write three short sections, each starting on its own line with exactly "Bull case:", "Bear case:" or "Open questions:".
After every claim, cite its source id in square brackets, such as [facts], [news-2] or [filing-…], using only ids listed in the message.
Use only numbers that appear in the facts, written as they are there. If something isn't in the facts, say it was not found; never guess.
Never recommend buying, selling or holding, never give a rating, score or price target, and never call the stock undervalued or overvalued.`;

const FILING_INSTRUCTIONS = `Summarise this SEC filing for a private investor in about 300 words, in the company's own terms:
results, guidance, risks and anything notable that changed. Use only the filing's text, and quote figures exactly as written.
Make no recommendation and give no rating.`;

export type GeminiConfig = {
  apiKey: string;
  model?: string;
  /** How long to wait for a batch before falling back to direct calls. */
  batchTimeLimitMs?: number;
  pollIntervalMs?: number;
  fetch?: typeof fetch;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type GenerateRequest = {
  systemInstruction: { parts: { text: string }[] };
  contents: { role: "user"; parts: { text: string }[] }[];
  generationConfig: { maxOutputTokens: number; temperature: number; thinkingConfig: { thinkingBudget: number } };
};

const roundCost = (n: number) => Math.round(n * 1e8) / 1e8;
const tokensIn = (text: string) => Math.ceil(text.length / 4);

function briefPrompt(r: BriefRequest): string {
  return [
    `Company: ${r.companyName} (${r.primaryTicker}), Sector: ${r.sector ?? "not found"}`,
    `Why this Brief: ${r.triggers.join(", ")}`,
    "",
    "Facts:",
    r.factsText,
    "",
    "Sources you may cite:",
    ...r.sources.map((s) => `[${s.id}] ${s.title}`),
  ].join("\n");
}

const filingPrompt = (r: FilingRequest) => `${r.companyName}, ${r.form} filed ${r.filedOn}:\n\n${r.text}`;

function request(instructions: string, prompt: string, maxOutputTokens: number): GenerateRequest {
  return {
    systemInstruction: { parts: [{ text: instructions }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens, temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } },
  };
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** The text and usage of a GenerateContentResponse, priced at `price`. */
function resultOf(response: unknown, price: { input: number; output: number }): AiResult | null {
  if (!isObject(response)) return null;
  const candidate = Array.isArray(response.candidates) ? response.candidates[0] : undefined;
  const parts = isObject(candidate) && isObject(candidate.content) && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const text = parts.map((p) => (isObject(p) && typeof p.text === "string" ? p.text : "")).join("").trim();
  const usage = isObject(response.usageMetadata) ? response.usageMetadata : {};
  const inputTokens = typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : 0;
  const outputTokens =
    (typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : 0) +
    (typeof usage.thoughtsTokenCount === "number" ? usage.thoughtsTokenCount : 0);
  return {
    text,
    usage: { inputTokens, outputTokens, costUsd: roundCost(inputTokens * price.input + outputTokens * price.output) },
  };
}

export function geminiWriter({
  apiKey,
  model = GEMINI_MODEL,
  batchTimeLimitMs = 45 * 60_000,
  pollIntervalMs = 30_000,
  fetch: doFetch = fetch,
  clock = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: GeminiConfig): AiWriter {
  if (!apiKey) throw new Error("GEMINI_API_KEY must be set (see .env.example).");

  async function call(method: "GET" | "POST", path: string, body?: unknown) {
    const response = await doFetch(`${BASE}/${path}`, {
      method,
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json: unknown = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, json };
  }

  async function direct(req: GenerateRequest): Promise<AiResult> {
    let problem = "";
    for (let attempt = 1; attempt <= DIRECT_ATTEMPTS; attempt++) {
      try {
        const { ok, status, json } = await call("POST", `models/${model}:generateContent`, req);
        if (ok) {
          const result = resultOf(json, PRICE.standard);
          if (result) return result;
          problem = "unexpected reply";
        } else {
          problem = `HTTP ${status}`;
          if (status === 400 || status === 401 || status === 403) break;
        }
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
      }
      await sleep(5_000 * attempt);
    }
    throw new Error(`Gemini generateContent: ${problem}`);
  }

  /** Submits one batch; returns its name, or null when it couldn't be created. */
  async function submit(requests: { req: GenerateRequest; key: string }[]): Promise<string | null> {
    try {
      const { ok, json } = await call("POST", `models/${model}:batchGenerateContent`, {
        batch: {
          display_name: `company-research-${new Date(clock()).toISOString().slice(0, 10)}`,
          input_config: { requests: { requests: requests.map(({ req, key }) => ({ request: req, metadata: { key } })) } },
        },
      });
      return ok && isObject(json) && typeof json.name === "string" ? json.name : null;
    } catch {
      return null;
    }
  }

  async function run(requests: GenerateRequest[]): Promise<AiResult[]> {
    const results: (AiResult | null)[] = requests.map(() => null);
    if (requests.length === 0) return [];

    // Batches small enough to send inline, each request keyed by its index.
    const groups: { req: GenerateRequest; key: string }[][] = [[]];
    let bytes = 0;
    requests.forEach((req, i) => {
      const size = JSON.stringify(req).length;
      if (groups.at(-1)!.length > 0 && bytes + size > MAX_BATCH_BYTES) {
        groups.push([]);
        bytes = 0;
      }
      groups.at(-1)!.push({ req, key: String(i) });
      bytes += size;
    });

    const pending = new Set<string>();
    for (const group of groups) {
      const name = await submit(group);
      if (name) pending.add(name);
    }

    const deadline = clock() + batchTimeLimitMs;
    while (pending.size > 0 && clock() < deadline) {
      await sleep(pollIntervalMs);
      for (const name of [...pending]) {
        const status = await call("GET", name).catch(() => null);
        const job = status?.ok && isObject(status.json) ? status.json : null;
        if (!job || job.done !== true) continue;
        pending.delete(name);
        const responses = isObject(job.response) ? job.response.inlinedResponses : undefined;
        const list = Array.isArray(responses)
          ? responses
          : isObject(responses) && Array.isArray(responses.inlinedResponses)
            ? responses.inlinedResponses
            : [];
        for (const item of list) {
          if (!isObject(item) || !isObject(item.metadata) || typeof item.metadata.key !== "string") continue;
          const result = item.error ? null : resultOf(item.response, PRICE.batch);
          if (result) results[Number(item.metadata.key)] = result;
        }
      }
    }
    for (const name of pending) await call("POST", `${name}:cancel`).catch(() => null);

    // Whatever the batch didn't answer in time is asked directly, at full price.
    for (const [i, req] of requests.entries()) results[i] ??= await direct(req);
    return results as AiResult[];
  }

  // Estimates use the full price and the most output allowed, so even a fallback stays within them.
  const estimate = (instructions: string, prompt: string, maxOutput: number) =>
    roundCost(tokensIn(instructions + prompt) * PRICE.standard.input + maxOutput * PRICE.standard.output);

  return {
    model,
    estimateBrief: (r) => estimate(BRIEF_INSTRUCTIONS, briefPrompt(r), BRIEF_MAX_OUTPUT),
    estimateFilingSummary: (r) => estimate(FILING_INSTRUCTIONS, filingPrompt(r), FILING_MAX_OUTPUT),
    writeBriefs: (requests) => run(requests.map((r) => request(BRIEF_INSTRUCTIONS, briefPrompt(r), BRIEF_MAX_OUTPUT))),
    summariseFilings: (requests) =>
      run(requests.map((r) => request(FILING_INSTRUCTIONS, filingPrompt(r), FILING_MAX_OUTPUT))),
  };
}
