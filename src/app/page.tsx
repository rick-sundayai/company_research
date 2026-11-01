import Link from "next/link";
import { SiteHeader } from "@/app/site-header";
import { listCompanies, type CompanyFilters, type MembershipFilter } from "@/lib/companies";
import { membershipText } from "@/lib/membership-text";
import { requireResearcher } from "@/lib/require-researcher";
import { isStance, STANCES } from "@/lib/stances";

const MEMBERSHIP_FILTERS: { value: MembershipFilter; label: string }[] = [
  { value: "current", label: "Current members" },
  { value: "former", label: "Former members" },
  { value: "all", label: "All" },
];

function membershipFilter(value: string | undefined): MembershipFilter {
  return MEMBERSHIP_FILTERS.find((f) => f.value === value)?.value ?? "current";
}

/** The list's address for a set of filters, leaving out the defaults. */
function listHref({ membership, stance, researchList }: CompanyFilters): string {
  const params = new URLSearchParams();
  if (membership !== "current") params.set("membership", membership);
  if (stance) params.set("stance", stance);
  if (researchList) params.set("list", "on");
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

/** The Company list: every Company the app tracks, filtered by Index Membership, Stance and the Research List. */
export default async function CompanyListPage({
  searchParams,
}: {
  searchParams: Promise<{ membership?: string; stance?: string; list?: string }>;
}) {
  const { supabase } = await requireResearcher();
  const params = await searchParams;
  const membership = membershipFilter(params.membership);
  const filters: CompanyFilters = {
    membership,
    stance: isStance(params.stance) ? params.stance : undefined,
    researchList: params.list === "on",
  };
  const filtered = membership !== "all" || filters.stance !== undefined || filters.researchList;
  const [companies, everything] = await Promise.all([
    listCompanies(supabase, filters),
    filtered ? listCompanies(supabase, { membership: "all" }) : null,
  ]);
  const anyCompanies = (everything ?? companies).length > 0;

  return (
    <>
      <SiteHeader supabase={supabase} />
      <h1>Companies</h1>
      {!anyCompanies ? (
        <div className="empty">
          <p>No Companies yet.</p>
          <p>They appear after the first overnight run reads the S&amp;P 500&apos;s members.</p>
        </div>
      ) : (
        <>
          <nav className="filters" aria-label="Index Membership">
            {MEMBERSHIP_FILTERS.map((f) => (
              <Link
                key={f.value}
                href={listHref({ ...filters, membership: f.value })}
                aria-current={f.value === membership ? "page" : undefined}
              >
                {f.label}
              </Link>
            ))}
          </nav>
          <nav className="filters" aria-label="Stance">
            {[undefined, ...STANCES].map((s) => (
              <Link
                key={s ?? "any"}
                href={listHref({ ...filters, stance: s })}
                aria-current={s === filters.stance ? "page" : undefined}
              >
                {s ?? "Any Stance"}
              </Link>
            ))}
          </nav>
          <nav className="filters" aria-label="Research List">
            {[false, true].map((on) => (
              <Link
                key={String(on)}
                href={listHref({ ...filters, researchList: on })}
                aria-current={on === filters.researchList ? "page" : undefined}
              >
                {on ? "On the Research List" : "On or off the list"}
              </Link>
            ))}
          </nav>
          {companies.length === 0 ? (
            <p className="empty">No Companies here.</p>
          ) : (
            <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Ticker</th>
                  <th scope="col">Other tickers</th>
                  <th scope="col">Sector</th>
                  <th scope="col">Index Membership</th>
                  <th scope="col">Stance</th>
                  <th scope="col">Research List</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => (
                  <tr key={company.cik}>
                    <td>
                      <Link href={`/companies/${company.cik}`}>{company.name}</Link>
                    </td>
                    <td>{company.primaryTicker}</td>
                    <td>{company.otherTickers.join(", ")}</td>
                    <td className={company.sector ? undefined : "not-found"}>{company.sector ?? "not found"}</td>
                    <td>{membershipText(company)}</td>
                    <td>{company.stance}</td>
                    <td>{company.onResearchList ? "On the list" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
