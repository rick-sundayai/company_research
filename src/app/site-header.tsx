import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { SignOutForm } from "@/app/sign-out/sign-out-form";
import { formatDay } from "@/lib/format";
import { missedNight } from "@/lib/missed-night";

/** The top of every signed-in page: navigation, sign-out, and the missed-night banner when it applies. */
export async function SiteHeader({ supabase }: { supabase: SupabaseClient }) {
  const missed = await missedNight(supabase, new Date());
  return (
    <header className="site-header">
      <nav aria-label="Main">
        <Link href="/">Companies</Link>
        <Link href="/digest">Digest</Link>
      </nav>
      <SignOutForm />
      {missed ? (
        <p role="status" className="banner">
          {missed.lastSucceededAt
            ? `The last successful overnight run finished on ${formatDay(missed.lastSucceededAt)}, more than 30 hours ago. A night may have been missed, so facts and Triggers may be stale.`
            : "No overnight run has succeeded yet, so there are no facts or Triggers to show."}
        </p>
      ) : null}
    </header>
  );
}
