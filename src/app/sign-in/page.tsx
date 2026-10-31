import { requestSignInLink } from "./actions";

const errors: Record<string, string> = {
  "not-allowed": "That email is not allowed to sign in.",
  failed: "Could not send a sign-in link. Please try again.",
  link: "That sign-in link did not work. Please request a new one.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { error, sent } = await searchParams;

  return (
    <>
      <h1>Sign in</h1>
      {sent ? (
        <p role="status">Check your email for a sign-in link.</p>
      ) : (
        <form action={requestSignInLink}>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" />
          <button type="submit">Email me a sign-in link</button>
        </form>
      )}
      {error && errors[error] && (
        <p role="alert" className="error">
          {errors[error]}
        </p>
      )}
    </>
  );
}
