import { FactsTable } from "@/app/facts-table";
import type { Brief } from "@/lib/briefs";
import { TRIGGER_NAMES } from "@/lib/digest";
import { formatDate, formatDay, formatPrice } from "@/lib/format";
import { formatFact, KEY_FACTS } from "@/lib/key-facts";
import { triggerText } from "@/lib/trigger-text";

const showChange = (label: string, value: number | null) => {
  if (label === "Price") return value === null ? "not found" : formatPrice(value);
  return formatFact(value, KEY_FACTS.find((f) => f.label === label)?.unit ?? "ratio");
};
const percent = (change: number) => `${change >= 0 ? "up" : "down"} ${Math.round(Math.abs(change) * 1000) / 10}%`;

/** One Company Brief in full: what the app found, never edited. */
export function BriefView({ brief, companyName }: { brief: Brief; companyName: string }) {
  const { facts } = brief;
  const headingId = `brief-${brief.id}`;
  return (
    <article aria-labelledby={headingId} className="brief">
      <h2 id={headingId}>Brief of {formatDate(brief.runDate)}</h2>
      <p>Triggers: {brief.triggers.map((t) => TRIGGER_NAMES[t]).join(", ")}</p>
      {facts.triggers
        .map((t) => ({ t, text: triggerText(t) }))
        .filter(({ text }) => text)
        .map(({ t, text }) => (
          <p key={t.kind} className="trigger-detail">
            {TRIGGER_NAMES[t.kind]}: {text}
          </p>
        ))}

      <p>
        Price: {facts.price === null ? "not found" : formatPrice(facts.price)}
        {facts.sinceStance && facts.sinceStance.change !== null
          ? ` · ${percent(facts.sinceStance.change)} since your ${facts.sinceStance.stance} Stance on ${formatDay(facts.sinceStance.setAt)} (${formatPrice(facts.sinceStance.priceThen)})`
          : null}
      </p>

      <h3>Summary</h3>
      <p className="notice">{brief.notice}</p>
      <div className="summary">
        {brief.summary.split("\n").map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>

      <h3>What changed</h3>
      {facts.previousBriefOn === null ? (
        <p>This is the first Brief.</p>
      ) : facts.changes.length === 0 ? (
        <p>Nothing changed since the Brief of {formatDate(facts.previousBriefOn)}.</p>
      ) : (
        <ul>
          <li className="plain">Since the Brief of {formatDate(facts.previousBriefOn)}:</li>
          {facts.changes.map((c) => (
            <li key={c.label}>
              {c.label}: {showChange(c.label, c.from)} to {showChange(c.label, c.to)}
            </li>
          ))}
        </ul>
      )}

      <FactsTable facts={facts.facts} companyName={companyName} />

      <h3 id={`${headingId}-news`}>News</h3>
      {facts.news.length === 0 ? (
        <p className="not-found">No news found.</p>
      ) : (
        <ul aria-labelledby={`${headingId}-news`}>
          {facts.news.map((n) => (
            <li key={n.id}>
              [{n.id}]{" "}
              <a href={n.url} rel="noopener noreferrer">
                {n.headline}
              </a>{" "}
              ({n.source}, {formatDay(n.publishedAt)})
            </li>
          ))}
        </ul>
      )}

      <h3 id={`${headingId}-sources`}>Sources</h3>
      <ul aria-labelledby={`${headingId}-sources`}>
        {facts.sources.map((s) => (
          <li key={s.id}>
            [{s.id}] {s.url ? <a href={s.url} rel="noopener noreferrer">{s.title}</a> : s.title}
          </li>
        ))}
      </ul>
    </article>
  );
}
