"use client";

import { useActionState } from "react";
import { MAX_NOTE_LENGTH, STANCES, type Stance } from "@/lib/stances";
import { setStanceAction, type StanceFormState } from "./actions";

const initialState: StanceFormState = { error: null };

/** Sets a new Stance with a note. It only ever adds an entry; nothing earlier changes. */
export function StanceForm({ cik, current }: { cik: string; current: Stance }) {
  const [state, formAction, pending] = useActionState(setStanceAction.bind(null, cik), initialState);

  return (
    <form action={formAction} className="stance-form">
      <label htmlFor="stance">New Stance</label>
      <select id="stance" name="stance" defaultValue={current}>
        {STANCES.map((stance) => (
          <option key={stance} value={stance}>
            {stance}
          </option>
        ))}
      </select>
      <label htmlFor="note">Note</label>
      <textarea id="note" name="note" rows={3} maxLength={MAX_NOTE_LENGTH} />
      {state.error ? (
        <p role="alert" className="error">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        Set Stance
      </button>
    </form>
  );
}
