import { redirect } from "next/navigation";
import { SignOutForm } from "@/app/sign-out/sign-out-form";
import { researcherStatus } from "@/lib/researcher-status";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Where someone signed in without a Researcher row lands. It never calls requireResearcher (that
 * would redirect back here); only a signed-out visitor is sent away, to sign-in.
 */
export default async function NotResearcherPage() {
  const supabase = await createSupabaseServerClient();
  const result = await researcherStatus(supabase);
  if (result.status === "signed_out") redirect("/sign-in");
  if (result.status === "researcher") redirect("/");

  return (
    <>
      <SignOutForm />
      <h1>This account isn&apos;t set up as the Researcher</h1>
      <p>
        You are signed in, but this account is not the Researcher of this Company Research app, so
        there is nothing to show you. Sign out and sign in with the Researcher&apos;s email instead.
      </p>
    </>
  );
}
