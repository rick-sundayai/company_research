import { signOut } from "./actions";

/** The sign-out control shown on every signed-in page. */
export function SignOutForm() {
  return (
    <form action={signOut} className="sign-out">
      <button type="submit">Sign out</button>
    </form>
  );
}
