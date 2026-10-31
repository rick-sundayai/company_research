import type { SupabaseClient } from "@supabase/supabase-js";
import { isAllowedResearcherEmail } from "./allowed-researcher";

export type ResearcherStatus =
  | { status: "signed_out" }
  /** Signed in, but there is no Researcher row, or it is not the configured Researcher's. */
  | { status: "not_researcher" }
  | { status: "researcher"; researcher: { id: string; email: string } };

/** Tells "not signed in" apart from "signed in, but not set up as the Researcher". */
export async function researcherStatus(supabase: SupabaseClient): Promise<ResearcherStatus> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { status: "signed_out" };

  // Row-level security means this returns only the signed-in Researcher's own row.
  const { data: researcher, error } = await supabase
    .from("researchers")
    .select("id, email")
    .eq("id", auth.user.id)
    .maybeSingle();
  // A failed read is not "not the Researcher": it must not send the real Researcher to /not-researcher.
  if (error) throw new Error(`Could not read the Researcher: ${error.message}`);
  // The configured email is the only one admitted, whatever other Researcher rows exist.
  if (!researcher || !isAllowedResearcherEmail(researcher.email)) return { status: "not_researcher" };

  return { status: "researcher", researcher };
}
