"use server";

import { revalidatePath } from "next/cache";
import { requireResearcher } from "@/lib/require-researcher";
import { requestBrief } from "@/lib/brief-requests";
import { changeResearchList } from "@/lib/research-list";
import { isStance, noteProblem, setStance } from "@/lib/stances";

export type StanceFormState = { error: string | null };

/** Adds the Researcher's new Stance entry for a Company. */
export async function setStanceAction(cik: string, _previous: StanceFormState, form: FormData): Promise<StanceFormState> {
  const { supabase } = await requireResearcher();
  const stance = form.get("stance");
  const note = String(form.get("note") ?? "");
  if (!isStance(stance)) return { error: "Pick one of the four Stances." };
  const problem = noteProblem(note);
  if (problem) return { error: problem };

  await setStance(supabase, cik, stance, note);
  revalidatePath(`/companies/${cik}`);
  revalidatePath("/");
  return { error: null };
}

/** The Researcher adds the Company to, or removes it from, the Research List. */
export async function changeResearchListAction(cik: string, change: "added" | "removed") {
  const { supabase } = await requireResearcher();
  await changeResearchList(supabase, cik, change);
  revalidatePath(`/companies/${cik}`);
  revalidatePath("/");
}

/** The Researcher asks for a fresh Brief, written by the next overnight run ahead of everything else. */
export async function requestBriefAction(cik: string) {
  const { supabase } = await requireResearcher();
  await requestBrief(supabase, cik);
  revalidatePath(`/companies/${cik}`);
}
