import type { CompanyRow } from "@/lib/companies";
import { formatDate } from "@/lib/format";

/** A Company's Index Membership as its latest change, e.g. "Joined Nov 2, 2026". */
export function membershipText(company: CompanyRow): string {
  const latest = company.history.at(-1);
  if (!latest) return company.membership === "current" ? "Member" : "Former member";
  return `${latest.change === "joined" ? "Joined" : "Left"} ${formatDate(latest.seenOn)}`;
}
