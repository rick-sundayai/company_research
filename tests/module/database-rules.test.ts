import { afterAll, describe, expect, it } from "vitest";
import {
  adminClient,
  anonClient,
  createTestResearcher,
  forgetTestEmails,
  readLocalSupabase,
  uniqueTestEmail,
  withDb,
} from "../support/local-supabase";

const stack = readLocalSupabase();
const createdEmails: string[] = [];

afterAll(() => forgetTestEmails(stack, createdEmails));

describe("Who can sign in and what they can read", () => {
  it("refuses to create a user whose email is not allowed, even through the admin API", async () => {
    const email = uniqueTestEmail("stranger");
    createdEmails.push(email);

    const { error } = await adminClient(stack).auth.admin.createUser({ email, email_confirm: true });

    expect(error).not.toBeNull();
    const users = await withDb(stack, (db) => db.query("select 1 from auth.users where email = $1", [email]));
    expect(users.rowCount).toBe(0);
  });

  it("creates the Researcher on first sign-in of an allowed email", async () => {
    const researcher = await createTestResearcher(stack, "first-sign-in", createdEmails);

    const { data, error } = await researcher.supabase.from("researchers").select("id, email");

    expect(error).toBeNull();
    expect(data).toEqual([{ id: researcher.id, email: researcher.email }]);
  });

  it("lets a visitor who is not signed in read nothing", async () => {
    await createTestResearcher(stack, "hidden-from-anon", createdEmails);

    const { data } = await anonClient(stack).from("researchers").select("id");

    expect(data ?? []).toEqual([]);
  });
});
