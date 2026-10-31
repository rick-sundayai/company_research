import Link from "next/link";
import { SignOutForm } from "@/app/sign-out/sign-out-form";
import { listCompanies, type CompanyRow, type MembershipFilter } from "@/lib/companies";
import { formatDate } from "@/lib/format";
import { requireResearcher } from "@/lib/require-researcher";

const FILTERS: { value: MembershipFilter; label: string }[] = [
  { value: "current", label: "Current members" },
  { value: "former", label: "Former members" },
  { value: "all", label: "All" },
];

function membershipFilter(value: string | undefined): MembershipFilter {
  return FILTERS.find((f) => f.value === value)?.value ?? "current";
}

function membershipText(company: CompanyRow): string {
  const latest = company.history.at(-1);
  if (!latest) return company.membership === "current" ? "Member" : "Former member";
  return `${latest.change === "joined" ? "Joined" : "Left"} ${formatDate(latest.seenOn)}`;
}

/** The Company list: every Company the app tracks, filtered by Index Membership. */
export default async function CompanyListPage({
  searchParams,
}: {
  searchParams: Promise<{ membership?: string }>;
}) {
  const { supabase } = await requireResearcher();
  const membership = membershipFilter((await searchParams).membership);
  const [companies, everything] = await Promise.all([
    listCompanies(supabase, { membership }),
    membership === "all" ? null : listCompanies(supabase, { membership: "all" }),
  ]);
  const anyCompanies = (everything ?? companies).length > 0;

  return (
    <>
      <SignOutForm />
      <h1>Companies</h1>
      {!anyCompanies ? (
        <div className="empty">
          <p>No Companies yet.</p>
          <p>They appear after the first overnight run reads the S&amp;P 500&apos;s members.</p>
        </div>
      ) : (
        <>
          <nav className="filters" aria-label="Index Membership">
            {FILTERS.map((f) => (
              <Link
                key={f.value}
                href={f.value === "current" ? "/" : `/?membership=${f.value}`}
                aria-current={f.value === membership ? "page" : undefined}
              >
                {f.label}
              </Link>
            ))}
          </nav>
          {companies.length === 0 ? (
            <p className="empty">No Companies here.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Ticker</th>
                  <th scope="col">Other tickers</th>
                  <th scope="col">Sector</th>
                  <th scope="col">Index Membership</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => (
                  <tr key={company.cik}>
                    <td>{company.name}</td>
                    <td>{company.primaryTicker}</td>
                    <td>{company.otherTickers.join(", ")}</td>
                    <td className={company.sector ? undefined : "not-found"}>{company.sector ?? "not found"}</td>
                    <td>{membershipText(company)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}
