"use server";

import { revalidatePath } from "next/cache";
import { requireResearcher } from "@/lib/require-researcher";
import { changeResearchList } from "@/lib/research-list";

/** Adds a Company named off the list in the Digest to the Research List, in one step. */
export async function addFromDigestAction(cik: string) {
  const { supabase } = await requireResearcher();
  await changeResearchList(supabase, cik, "added");
  revalidatePath("/digest");
  revalidatePath(`/companies/${cik}`);
  revalidatePath("/");
}
