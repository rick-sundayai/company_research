"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAllowedResearcherEmail } from "@/lib/allowed-researcher";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function requestSignInLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  // Refuse before Supabase Auth is ever contacted. The database refuses too (see the researcher migration).
  if (!isAllowedResearcherEmail(email)) redirect("/sign-in?error=not-allowed");

  const origin = (await headers()).get("origin");
  if (!origin) redirect("/sign-in?error=failed");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) redirect("/sign-in?error=failed");

  redirect("/sign-in?sent=1");
}
