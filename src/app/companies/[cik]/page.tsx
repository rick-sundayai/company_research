import { notFound } from "next/navigation";
import Link from "next/link";
import { BriefView } from "@/app/brief-view";
import { FactsTable } from "@/app/facts-table";
import { SiteHeader } from "@/app/site-header";
import { pendingRequest } from "@/lib/brief-requests";
import { briefHistory, heldBackBriefs } from "@/lib/briefs";
import { getCompany } from "@/lib/companies";
import { TRIGGER_NAMES } from "@/lib/digest";
import { companyFacts } from "@/lib/facts";
import { formatDate, formatDay, formatPrice } from "@/lib/format";
import { membershipText } from "@/lib/membership-text";
import { requireResearcher } from "@/lib/require-researcher";
import { researchListChangeText, researchListHistory } from "@/lib/research-list";
import { stanceHistory } from "@/lib/stances";
import { changeResearchListAction, requestBriefAction } from "./actions";
import { StanceForm } from "./stance-form";

/**
 * A Company's page: its tickers, Sector and membership, its key facts beside their Sector Medians,
 * its place on the Research List, and the Researcher's Stance.
 */
export default async function CompanyPage({ params }: { params: Promise<{ cik: string }> }) {
  const { supabase } = await requireResearcher();
  const { cik } = await params;
  const [company, facts, history, listChanges, briefs, heldBack, request] = await Promise.all([
    getCompany(supabase, cik),
    companyFacts(supabase, cik),
    stanceHistory(supabase, cik),
    researchListHistory(supabase, cik),
    briefHistory(supabase, cik),
    heldBackBriefs(supabase, cik),
    pendingRequest(supabase, cik),
  ]);
  if (!company) notFound();
  const current = history[0]?.stance ?? "Unreviewed";

  return (
    <>
      <SiteHeader supabase={supabase} />
      <h1>{company.name}</h1>
      <dl className="facts">
        <dt>Tickers</dt>
        <dd>
          {company.primaryTicker}
          {company.otherTickers.length > 0 ? ` · also ${company.otherTickers.join(", ")}` : null}
        </dd>
        <dt>Sector</dt>
        <dd className={company.sector ? undefined : "not-found"}>{company.sector ?? "not found"}</dd>
        <dt>Index Membership</dt>
        <dd>{membershipText(company)}</dd>
      </dl>

      <section aria-labelledby="briefs-heading">
        <h2 id="briefs-heading">Briefs</h2>
        {request ? (
          <p>Brief requested on {formatDay(request.requestedAt)}: the next overnight run writes it first.</p>
        ) : company.onResearchList && company.membership === "current" ? (
          <form action={requestBriefAction.bind(null, company.cik)}>
            <button type="submit">Request a Brief</button>
          </form>
        ) : (
          <p className="not-found">Add it to the Research List to request a Brief.</p>
        )}
        {briefs.length === 0 ? (
          <p className="not-found">No Brief yet.</p>
        ) : (
          <>
            <BriefView brief={briefs[0]} companyName={company.name} />
            <h3 id="brief-history-heading">Brief history</h3>
            <ol className="history" aria-labelledby="brief-history-heading">
              {briefs.map((b) => (
                <li key={b.id}>
                  <Link href={`/briefs/${b.id}`}>{formatDate(b.runDate)}</Link> {b.triggers.map((t) => TRIGGER_NAMES[t]).join(", ")}
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      {heldBack.length > 0 ? (
        <section aria-labelledby="held-back-heading">
          <h2 id="held-back-heading">Held back by the Source Check</h2>
          <p>These Briefs failed the Source Check and are never shown as the latest Brief.</p>
          <ul className="history">
            {heldBack.map((b) => (
              <li key={b.id}>
                {formatDate(b.runDate)} ({b.triggers.map((t) => TRIGGER_NAMES[t]).join(", ")})
                <ul>
                  {b.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="facts-heading">
        <h2 id="facts-heading">Facts</h2>
        {facts === null ? (
          <p className="not-found">Not checked yet. Facts appear after the next Nightly Check.</p>
        ) : (
          <>
            <p>As of the Nightly Check on {formatDate(facts.asOf)}</p>
            <p>Price: {facts.price === null ? "not found" : formatPrice(facts.price)}</p>
            <FactsTable facts={facts.facts} companyName={company.name} />
          </>
        )}
      </section>

      <section aria-labelledby="research-list-heading">
        <h2 id="research-list-heading">Research List</h2>
        <p>{company.onResearchList ? "On the Research List" : "Not on the Research List"}</p>
        {company.onResearchList ? (
          <form action={changeResearchListAction.bind(null, company.cik, "removed")}>
            <button type="submit">Remove from the Research List</button>
          </form>
        ) : company.membership === "current" ? (
          <form action={changeResearchListAction.bind(null, company.cik, "added")}>
            <button type="submit">Add to the Research List</button>
          </form>
        ) : (
          <p className="not-found">Only current members of the index can be added.</p>
        )}
        {listChanges.length > 0 ? (
          <>
            <h3 id="research-list-history-heading">Research List history</h3>
            <ol className="history" aria-labelledby="research-list-history-heading">
              {listChanges.map((c, i) => (
                <li key={`${c.changedAt}-${i}`}>
                  <time dateTime={c.changedAt}>{formatDay(c.changedAt)}</time> {researchListChangeText(c)}
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </section>

      <section aria-labelledby="stance-heading">
        <h2 id="stance-heading">Stance</h2>
        <p className="current-stance">
          Current Stance: <strong>{current}</strong>
        </p>
        <StanceForm cik={company.cik} current={current} />

        <h3 id="stance-history-heading">Stance history</h3>
        {history.length === 0 ? (
          <p className="not-found">No Stance entries yet.</p>
        ) : (
          <ol className="history" aria-labelledby="stance-history-heading">
            {history.map((entry, i) => (
              <li key={`${entry.setAt}-${i}`}>
                <time dateTime={entry.setAt}>{formatDay(entry.setAt)}</time> <strong>{entry.stance}</strong>
                <p>{entry.note}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
