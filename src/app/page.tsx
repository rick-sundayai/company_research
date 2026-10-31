import { SignOutForm } from "@/app/sign-out/sign-out-form";
import { requireResearcher } from "@/lib/require-researcher";

/** The Company list. Companies arrive with the first Nightly Check that updates Index Membership. */
export default async function CompanyListPage() {
  await requireResearcher();

  return (
    <>
      <SignOutForm />
      <h1>Companies</h1>
      <div className="empty">
        <p>No Companies yet.</p>
        <p>They appear after the first overnight run reads the S&amp;P 500&apos;s members.</p>
      </div>
    </>
  );
}
