import type { AiResult, AiWriter, BriefRequest, FilingRequest } from "../../src/night/ai-writer";

export type FakeAiWriter = AiWriter & {
  /** Every Brief request, in the order written. */
  written: BriefRequest[];
  /** Every Filing summarised, in order. */
  summarised: FilingRequest[];
};

/**
 * An AI writer for tests. Each Brief costs `cost` dollars (estimated and actual alike, unless
 * `actualCost` says otherwise), and its summary cites the facts and every source it was given. A Filing
 * summary costs the same and quotes the start of the Filing.
 */
export function fakeAiWriter({
  cost = 0.01,
  actualCost,
  summary,
}: {
  cost?: number;
  actualCost?: number;
  /** Replaces the summary, e.g. with one the Source Check should hold back. */
  summary?: (request: BriefRequest) => string;
} = {}): FakeAiWriter {
  const written: BriefRequest[] = [];
  const summarised: FilingRequest[] = [];
  return {
    model: "fake-writer",
    written,
    summarised,
    estimateFilingSummary: () => cost,
    async summariseFilings(requests): Promise<AiResult[]> {
      summarised.push(...requests);
      return requests.map((request) => ({
        text: `The ${request.form} filed ${request.filedOn} says: ${request.text.slice(0, 60)}`,
        usage: { inputTokens: 80000, outputTokens: 1500, costUsd: actualCost ?? cost },
      }));
    },
    estimateBrief: () => cost,
    async writeBriefs(requests): Promise<AiResult[]> {
      written.push(...requests);
      return requests.map((request) => ({
        text: summary?.(request) ?? [
          `Bull case: ${request.companyName} has room to grow [facts].`,
          `Bear case: the Sector may be crowded [facts].`,
          `Open questions: ${request.sources.map((s) => `[${s.id}]`).join(" ")}`,
        ].join("\n"),
        usage: { inputTokens: 8000, outputTokens: 3500, costUsd: actualCost ?? cost },
      }));
    },
  };
}
