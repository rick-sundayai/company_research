import type { SupabaseClient } from "@supabase/supabase-js";

/** The four Stances, in the order the Researcher picks from. Every Company starts Unreviewed. */
export const STANCES = ["Unreviewed", "Watching", "Candidate", "Avoid"] as const;
export type Stance = (typeof STANCES)[number];

export const MAX_NOTE_LENGTH = 500;

export type StanceEntry = { stance: Stance; note: string; setAt: string };

export function isStance(value: unknown): value is Stance {
  return STANCES.includes(value as Stance);
}

/** Why a note can't be used, or null when it's fine. */
export function noteProblem(note: string): string | null {
  if (note.trim() === "") return "Add a short note saying why.";
  if (note.length > MAX_NOTE_LENGTH) return `Keep the note to ${MAX_NOTE_LENGTH} characters.`;
  return null;
}

/** Every Stance entry for a Company, newest first. Its current Stance is the first, or Unreviewed when there are none. */
export async function stanceHistory(supabase: SupabaseClient, cik: string): Promise<StanceEntry[]> {
  const { data, error } = await supabase
    .from("stance_entries")
    .select("stance, note, set_at")
    .eq("cik", cik)
    .order("set_at", { ascending: false })
    .order("id", { ascending: false })
    .returns<{ stance: Stance; note: string; set_at: string }[]>();
  if (error) throw new Error(`Could not read Stance history: ${error.message}`);
  return data.map((row) => ({ stance: row.stance, note: row.note, setAt: row.set_at }));
}

/** Adds a Stance entry, which becomes the Company's current Stance. Earlier entries are kept as they were. */
export async function setStance(supabase: SupabaseClient, cik: string, stance: Stance, note: string) {
  const { error } = await supabase.from("stance_entries").insert({ cik, stance, note: note.trim() });
  if (error) throw new Error(`Could not set the Stance: ${error.message}`);
}
