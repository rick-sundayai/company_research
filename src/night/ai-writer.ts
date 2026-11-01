// The AI writer (Gemini 3.5 Flash-Lite in production; a fake in tests). It summarises Filings, and
// writes a Brief's summary from the Brief's own facts and sources. Requests go in as
// a list so the adapter can send them as one batch; each result carries its real token usage and cost.

export type AiUsage = { inputTokens: number; outputTokens: number; costUsd: number };
export type AiResult = { text: string; usage: AiUsage };

/** A source a Brief's summary may cite, by its id in square brackets, e.g. [news-2]. */
export type BriefSource = { id: string; kind: "facts" | "news" | "filing"; title: string; url: string | null };

/** Everything a Brief's summary may draw on. Nothing else: no general knowledge, no open web. */
export type BriefRequest = {
  companyName: string;
  primaryTicker: string;
  sector: string | null;
  triggers: string[];
  /** The Brief's facts as text, one per line, each with its Sector Median; gaps say "not found". */
  factsText: string;
  sources: BriefSource[];
};

/** A Filing to summarise once, when it arrives; the summary is reused by every later Brief. */
export type FilingRequest = { companyName: string; form: string; filedOn: string; text: string };

export interface AiWriter {
  /** The model's name, shown in each Brief's machine-written notice. */
  readonly model: string;
  /** The estimated cost of writing this Brief's summary, in dollars, before any call is made. */
  estimateBrief(request: BriefRequest): number;
  /** Writes each Brief's summary: a bull case, a bear case and open questions, citing sources by id. */
  writeBriefs(requests: BriefRequest[]): Promise<AiResult[]>;
  /** The estimated cost of summarising this Filing, in dollars. */
  estimateFilingSummary(request: FilingRequest): number;
  /** Summarises each Filing in the Company's own terms: results, risks and changes, with figures. */
  summariseFilings(requests: FilingRequest[]): Promise<AiResult[]>;
}
