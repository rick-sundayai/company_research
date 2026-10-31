import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  adminClient,
  anonClient,
  createTestResearcher,
  forgetResearchData,
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

describe("Companies", () => {
  beforeEach(async () => {
    await forgetResearchData(stack);
    await withDb(stack, (db) =>
      db.query(
        `insert into public.companies (cik, name, sector, is_current_member, first_seen_on)
         values ('9200000001', 'Ironbark Rail (fictional)', 'Industrials', true, '2026-11-02')`,
      ),
    );
  });
  afterAll(() => forgetResearchData(stack));

  it("can never be deleted, even with direct database access", async () => {
    await expect(
      withDb(stack, (db) => db.query("delete from public.companies where cik = '9200000001'")),
    ).rejects.toThrow("Companies are never deleted");
    await expect(withDb(stack, (db) => db.query("truncate public.companies cascade"))).rejects.toThrow(
      "Companies are never deleted",
    );

    const left = await withDb(stack, (db) => db.query("select 1 from public.companies where cik = '9200000001'"));
    expect(left.rowCount).toBe(1);
  });

  it("are readable by the Researcher and by no one who isn't signed in", async () => {
    const researcher = await createTestResearcher(stack, "reads-companies", createdEmails);

    const asResearcher = await researcher.supabase.from("companies").select("cik");
    const asAnon = await anonClient(stack).from("companies").select("cik");

    expect(asResearcher.data).toEqual([{ cik: "9200000001" }]);
    expect(asAnon.data ?? []).toEqual([]);
  });

  it("can't be written by the Researcher; only the nightly job writes them", async () => {
    const researcher = await createTestResearcher(stack, "writes-companies", createdEmails);

    await researcher.supabase.from("companies").update({ name: "Renamed" }).eq("cik", "9200000001");

    const row = await withDb(stack, (db) => db.query("select name from public.companies where cik = '9200000001'"));
    expect(row.rows[0].name).toBe("Ironbark Rail (fictional)");
  });
});
