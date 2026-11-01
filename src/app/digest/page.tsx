import Link from "next/link";
import { SiteHeader } from "@/app/site-header";
import { researchBudget } from "@/lib/briefs";
import { latestDigest, TRIGGER_NAMES, type DigestCompany } from "@/lib/digest";
import { formatDate, formatPrice } from "@/lib/format";
import { requireResearcher } from "@/lib/require-researcher";
import { triggerText } from "@/lib/trigger-text";
import { researchListCiks } from "@/night/decide-triggers";
import { addFromDigestAction } from "./actions";

function CompanyName({ company }: { company: DigestCompany }) {
  return (
    <>
      <Link href={`/companies/${company.cik}`}>{company.name}</Link> {company.primaryTicker}
      {company.stance === "Candidate" || company.stance === "Watching" ? (
        <span className="stance-tag"> · {company.stance}</span>
      ) : null}
    </>
  );
}

/** The Digest: what the latest overnight run found, and nothing from earlier nights. */
export default async function DigestPage() {
  const { supabase } = await requireResearcher();
  const [digest, onList] = await Promise.all([latestDigest(supabase), researchListCiks(supabase)]);
  const { run } = digest;
  const budget = await researchBudget(supabase, run?.runDate ?? new Date().toISOString().slice(0, 10));
  const empty = digest.onList.length === 0 && digest.offList.length === 0;

  return (
    <>
      <SiteHeader supabase={supabase} />
      {run === null ? (
        <>
          <h1>Digest</h1>
          <p className="empty">No overnight run has finished yet.</p>
        </>
      ) : (
        <>
          <h1>Digest for the night of {formatDate(run.runDate)}</h1>
          {run.outcome === "failed" ? (
            <p className="error">The run failed: {run.error}</p>
          ) : null}
          {run.membershipUpdate === "refused" || run.membershipUpdate === "failed" ? (
            <p className="error">
              The Index Membership update {run.membershipUpdate === "refused" ? "was refused" : "failed"}
              {run.membershipNote ? `: ${run.membershipNote}` : "."} The Company list may be a day stale.
            </p>
          ) : null}
          <p className="budget">
            Research Budget: {formatPrice(budget.spent)} spent of {formatPrice(budget.limit)} this month,{" "}
            {formatPrice(budget.left)} left
          </p>
          {digest.briefsDeferred > 0 ? (
            <p>
              {digest.briefsDeferred} {digest.briefsDeferred === 1 ? "Brief was" : "Briefs were"} deferred to stay within
              the Research Budget.
            </p>
          ) : null}
          {digest.briefsHeldBack > 0 ? (
            <p>
              {digest.briefsHeldBack} {digest.briefsHeldBack === 1 ? "Brief was" : "Briefs were"} held back by the Source
              Check.
            </p>
          ) : null}
          {empty ? <p className="empty">Nothing fired that night.</p> : null}

          {digest.onList.map((group) => (
            <section key={group.trigger} aria-labelledby={`trigger-${group.trigger}`}>
              <h2 id={`trigger-${group.trigger}`}>{TRIGGER_NAMES[group.trigger]}</h2>
              <ul className="history">
                {group.companies.map((company) => (
                  <li key={company.cik}>
                    <CompanyName company={company} />
                    {triggerText(company.triggers.find((t) => t.kind === group.trigger)!) ? (
                      <p>{triggerText(company.triggers.find((t) => t.kind === group.trigger)!)}</p>
                    ) : null}
                    {company.brief ? (
                      <p>
                        <Link href={`/briefs/${company.brief.id}`}>Read the Brief</Link>
                      </p>
                    ) : company.heldBack ? (
                      <p className="not-found">Brief held back by the Source Check</p>
                    ) : (
                      <p className="not-found">Brief deferred by the Research Budget</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {digest.stale.length > 0 ? (
            <section aria-labelledby="stale">
              <h2 id="stale">Briefs over 7 days old</h2>
              <ul className="history">
                {digest.stale.map((c) => (
                  <li key={c.cik}>
                    <Link href={`/companies/${c.cik}`}>{c.name}</Link>: latest Brief {formatDate(c.lastBriefOn)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {digest.flagged.length > 0 ? (
            <section aria-labelledby="flagged">
              <h2 id="flagged">Held back twice in a row</h2>
              <p>Not retried until something new happens, such as earnings or a price move.</p>
              <ul className="history">
                {digest.flagged.map((c) => (
                  <li key={c.cik}>
                    <Link href={`/companies/${c.cik}`}>{c.name}</Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {digest.offList.length > 0 ? (
            <section aria-labelledby="off-list">
              <h2 id="off-list">Off the Research List</h2>
              <ul className="history">
                {digest.offList.map((company) => (
                  <li key={company.cik}>
                    <CompanyName company={company} />
                    {company.triggers.map((t) => (
                      <p key={t.kind}>
                        {TRIGGER_NAMES[t.kind]}: {triggerText(t)}
                      </p>
                    ))}
                    {onList.has(company.cik) ? (
                      <p>Added to the Research List</p>
                    ) : (
                      <form action={addFromDigestAction.bind(null, company.cik)}>
                        <button type="submit">Add to the Research List</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
