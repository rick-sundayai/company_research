import Link from "next/link";
import { notFound } from "next/navigation";
import { BriefView } from "@/app/brief-view";
import { SiteHeader } from "@/app/site-header";
import { getBrief } from "@/lib/briefs";
import { getCompany } from "@/lib/companies";
import { requireResearcher } from "@/lib/require-researcher";

/** One Brief on its own page, reached from the Digest or a Company's Brief history. */
export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireResearcher();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const brief = await getBrief(supabase, id);
  if (!brief) notFound();
  const company = await getCompany(supabase, brief.cik);
  if (!company) notFound();

  return (
    <>
      <SiteHeader supabase={supabase} />
      <h1>
        <Link href={`/companies/${company.cik}`}>{company.name}</Link>
      </h1>
      <BriefView brief={brief} companyName={company.name} />
    </>
  );
}
