import { redirect } from "next/navigation";
import { researcherStatus } from "@/lib/researcher-status";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The signed-in Researcher. A visitor who is signed out goes to sign-in; someone signed in
 * without a Researcher row goes to /not-researcher, which can sign them out.
 */
export async function requireResearcher() {
  const supabase = await createSupabaseServerClient();
  const result = await researcherStatus(supabase);
  if (result.status === "signed_out") redirect("/sign-in");
  if (result.status === "not_researcher") redirect("/not-researcher");

  return { supabase, researcher: result.researcher };
}
