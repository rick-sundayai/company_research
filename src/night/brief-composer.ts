// The Brief composer: assembles a Brief's facts from tonight's snapshot, the Sector Medians, the
// previous Brief, the latest Stance entry and news, plus the request the AI writer works from.
// Missing values become "not found"; nothing comes from outside these sources.

import { formatPrice } from "../lib/format";
import { formatFact, KEY_FACTS, type FactKey, type KeyFact } from "../lib/key-facts";
import type { Stance } from "../lib/stances";
import type { BriefRequest, BriefSource } from "./ai-writer";
import type { TriggerKind } from "./decide-triggers";
import type { NewsItem } from "./market-data";

export type BriefFact = { key: FactKey; label: string; unit: KeyFact["unit"]; value: number | null; sectorMedian: number | null };

/** What a Brief holds besides its summary. Stored with the Brief and never changed. */
export type BriefFacts = {
  asOf: string;
  sector: string | null;
  marketCap: number | null;
  price: number | null;
  triggers: { kind: TriggerKind; detail: Record<string, unknown> }[];
  facts: BriefFact[];
  /** What changed since the previous Brief; empty for the first. */
  previousBriefOn: string | null;
  changes: { label: string; from: number | null; to: number | null }[];
  /** The price change since the Researcher's latest Stance entry, where there is one. */
  sinceStance: { stance: Stance; setAt: string; priceThen: number; change: number | null } | null;
  news: (NewsItem & { id: string })[];
  sources: BriefSource[];
  /** The facts exactly as the AI writer was given them; the Source Check checks numbers against these. */
  factsText: string;
};

export type BriefInput = {
  runDate: string;
  companyName: string;
  primaryTicker: string;
  sector: string | null;
  triggers: { kind: TriggerKind; detail: Record<string, unknown> }[];
  price: number | null;
  marketCap: number | null;
  facts: Record<FactKey, number | null>;
  medians: Partial<Record<FactKey, number>>;
  previous: { runDate: string; facts: BriefFacts } | null;
  stance: { stance: Stance; setAt: string; priceThen: number | null } | null;
  news: NewsItem[];
  /** The latest 10-K and 10-Q with their one-time summaries. */
  filings: { accession: string; form: string; filedOn: string; url: string; summary: string }[];
};

const round = (n: number) => Math.round(n * 10_000) / 10_000;
const show = (value: number | null, unit: KeyFact["unit"] | "price") =>
  unit === "price" ? (value === null ? "not found" : formatPrice(value)) : formatFact(value, unit);

export function composeBrief(input: BriefInput): { facts: BriefFacts; request: BriefRequest } {
  const facts: BriefFact[] = KEY_FACTS.map((f) => ({
    key: f.key,
    label: f.label,
    unit: f.unit,
    value: input.facts[f.key],
    sectorMedian: input.medians[f.key] ?? null,
  }));

  const changes: BriefFacts["changes"] = [];
  if (input.previous) {
    const before = input.previous.facts;
    if (before.price !== input.price) changes.push({ label: "Price", from: before.price, to: input.price });
    for (const fact of facts) {
      const from = before.facts.find((f) => f.key === fact.key)?.value ?? null;
      if (from !== fact.value) changes.push({ label: fact.label, from, to: fact.value });
    }
  }

  const sinceStance =
    input.stance && input.stance.priceThen !== null
      ? {
          stance: input.stance.stance,
          setAt: input.stance.setAt,
          priceThen: input.stance.priceThen,
          change: input.price === null ? null : round(input.price / input.stance.priceThen - 1),
        }
      : null;

  const news = input.news.map((item, i) => ({ id: `news-${i + 1}`, ...item }));
  const sources: BriefSource[] = [
    { id: "facts", kind: "facts", title: `Finnhub market data from the Nightly Check of ${input.runDate}`, url: null },
    ...input.filings.map(
      (f): BriefSource => ({ id: `filing-${f.accession}`, kind: "filing", title: `${f.form} filed ${f.filedOn}`, url: f.url }),
    ),
    ...news.map((n): BriefSource => ({ id: n.id, kind: "news", title: `${n.headline} (${n.source})`, url: n.url })),
  ];

  const briefFacts: Omit<BriefFacts, "factsText"> = {
    asOf: input.runDate,
    sector: input.sector,
    marketCap: input.marketCap,
    price: input.price,
    triggers: input.triggers,
    facts,
    previousBriefOn: input.previous?.runDate ?? null,
    changes,
    sinceStance,
    news,
    sources,
  };

  const lines = [
    `Sector: ${input.sector ?? "not found"} [facts]`,
    `Price: ${show(input.price, "price")} [facts]`,
    `Market cap: ${input.marketCap === null ? "not found" : `$${Math.round(input.marketCap).toLocaleString("en-US")} million`} [facts]`,
    ...facts.map((f) => `${f.label}: ${show(f.value, f.unit)} (Sector Median ${show(f.sectorMedian, f.unit)}) [facts]`),
    ...(input.previous
      ? [
          `Since the previous Brief on ${input.previous.runDate}:`,
          ...(changes.length === 0
            ? ["  nothing changed [facts]"]
            : changes.map((c) => {
                const unit = c.label === "Price" ? "price" : (KEY_FACTS.find((f) => f.label === c.label)?.unit ?? "ratio");
                return `  ${c.label}: ${show(c.from, unit)} to ${show(c.to, unit)} [facts]`;
              })),
        ]
      : ["This is the first Brief."]),
    ...(input.filings.length === 0
      ? ["Filings: none found"]
      : input.filings.map((f) => `[filing-${f.accession}] ${f.form} filed ${f.filedOn}, summarised: ${f.summary}`)),
    ...(news.length === 0 ? ["News: none found"] : news.map((n) => `[${n.id}] ${n.headline} (${n.source}, ${n.publishedAt.slice(0, 10)})`)),
  ];

  const factsText = lines.join("\n");
  return {
    facts: { ...briefFacts, factsText },
    request: {
      companyName: input.companyName,
      primaryTicker: input.primaryTicker,
      sector: input.sector,
      triggers: input.triggers.map((t) => t.kind),
      factsText,
      sources,
    },
  };
}
