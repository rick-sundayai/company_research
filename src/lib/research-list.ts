import type { SupabaseClient } from "@supabase/supabase-js";

export type ResearchListChange = {
  change: "added" | "removed";
  reason: "by_hand" | "stance" | "first_run";
  changedAt: string;
};

/** Every addition to and removal from the Research List for a Company, newest first. */
export async function researchListHistory(supabase: SupabaseClient, cik: string): Promise<ResearchListChange[]> {
  const { data, error } = await supabase
    .from("research_list_changes")
    .select("change, reason, changed_at")
    .eq("cik", cik)
    .order("changed_at", { ascending: false })
    .order("id", { ascending: false })
    .returns<{ change: ResearchListChange["change"]; reason: ResearchListChange["reason"]; changed_at: string }[]>();
  if (error) throw new Error(`Could not read the Research List history: ${error.message}`);
  return data.map((row) => ({ change: row.change, reason: row.reason, changedAt: row.changed_at }));
}

/** The Researcher adds a current member to, or removes a Company from, the Research List by hand. */
export async function changeResearchList(supabase: SupabaseClient, cik: string, change: "added" | "removed") {
  const { error } = await supabase.from("research_list_changes").insert({ cik, change, reason: "by_hand" });
  if (error) throw new Error(`Could not change the Research List: ${error.message}`);
}

/** How a change reads in the history, e.g. "Added by hand". */
export function researchListChangeText({ change, reason }: Pick<ResearchListChange, "change" | "reason">): string {
  const verb = change === "added" ? "Added" : "Removed";
  if (reason === "stance") return `${verb} when the Stance became Watching or Candidate`;
  if (reason === "first_run") return `${verb} at the first run, as one of the 100 largest`;
  return `${verb} by hand`;
}
