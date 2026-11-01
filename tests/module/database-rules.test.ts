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

describe("Stance entries", () => {
  beforeEach(async () => {
    await forgetResearchData(stack);
    await withDb(stack, async (db) => {
      await db.query(
        `insert into public.companies (cik, name, sector, is_current_member, first_seen_on)
         values ('9200000002', 'Tidewater Looms (fictional)', 'Consumer Discretionary', true, '2026-11-02')`,
      );
      await db.query(
        `insert into public.stance_entries (cik, stance, note) values ('9200000002', 'Watching', 'Margins look thin')`,
      );
    });
  });
  afterAll(() => forgetResearchData(stack));

  it("can never be edited or deleted, even with direct database access", async () => {
    await expect(
      withDb(stack, (db) => db.query("update public.stance_entries set stance = 'Avoid'")),
    ).rejects.toThrow("Stance entries are never edited or removed");
    await expect(withDb(stack, (db) => db.query("delete from public.stance_entries"))).rejects.toThrow(
      "Stance entries are never edited or removed",
    );
    await expect(withDb(stack, (db) => db.query("truncate public.stance_entries"))).rejects.toThrow(
      "Stance entries are never edited or removed",
    );

    const left = await withDb(stack, (db) => db.query("select stance, note from public.stance_entries"));
    expect(left.rows).toEqual([{ stance: "Watching", note: "Margins look thin" }]);
  });

  it("are added and read by the Researcher, and read by no one who isn't signed in", async () => {
    const researcher = await createTestResearcher(stack, "sets-stance", createdEmails);

    const added = await researcher.supabase
      .from("stance_entries")
      .insert({ cik: "9200000002", stance: "Candidate", note: "Cheap against its Sector" });
    const asResearcher = await researcher.supabase.from("stance_entries").select("stance").order("id");
    const asAnon = await anonClient(stack).from("stance_entries").select("stance");

    expect(added.error).toBeNull();
    expect(asResearcher.data).toEqual([{ stance: "Watching" }, { stance: "Candidate" }]);
    expect(asAnon.data ?? []).toEqual([]);
  });

  it("are dated by the database, not by whoever adds them", async () => {
    const researcher = await createTestResearcher(stack, "backdates-stance", createdEmails);

    const backdated = await researcher.supabase
      .from("stance_entries")
      .insert({ cik: "9200000002", stance: "Avoid", note: "Too much debt", set_at: "2020-01-01T00:00:00Z" });

    expect(backdated.error).not.toBeNull();
  });

  it("refuses a Stance that isn't one of the four, and an empty note", async () => {
    await expect(
      withDb(stack, (db) =>
        db.query(`insert into public.stance_entries (cik, stance, note) values ('9200000002', 'Buy', 'Looks good')`),
      ),
    ).rejects.toThrow();
    await expect(
      withDb(stack, (db) =>
        db.query(`insert into public.stance_entries (cik, stance, note) values ('9200000002', 'Avoid', '  ')`),
      ),
    ).rejects.toThrow();
  });
});

describe("Research List", () => {
  const onList = () =>
    withDb(stack, (db) =>
      db.query("select cik, change, reason from public.research_list_changes order by id").then((r) => r.rows),
    );

  beforeEach(async () => {
    await forgetResearchData(stack);
    await withDb(stack, (db) =>
      db.query(
        `insert into public.companies (cik, name, sector, is_current_member, first_seen_on) values
           ('9200000003', 'Copperleaf Mills (fictional)', 'Materials', true, '2026-11-02'),
           ('9200000004', 'Sallow Bay Ferries (fictional)', 'Industrials', false, '2026-11-02')`,
      ),
    );
  });
  afterAll(() => forgetResearchData(stack));

  it("keeps every addition and removal; none can be edited or deleted, even with direct database access", async () => {
    await withDb(stack, (db) =>
      db.query(`insert into public.research_list_changes (cik, change, reason) values ('9200000003', 'added', 'by_hand')`),
    );

    await expect(withDb(stack, (db) => db.query("update public.research_list_changes set change = 'removed'"))).rejects.toThrow(
      "Research List changes are never edited or removed",
    );
    await expect(withDb(stack, (db) => db.query("delete from public.research_list_changes"))).rejects.toThrow(
      "Research List changes are never edited or removed",
    );
    await expect(withDb(stack, (db) => db.query("truncate public.research_list_changes"))).rejects.toThrow(
      "Research List changes are never edited or removed",
    );
    expect(await onList()).toEqual([{ cik: "9200000003", change: "added", reason: "by_hand" }]);
  });

  it("adds a current member when its Stance becomes Watching or Candidate, once", async () => {
    const researcher = await createTestResearcher(stack, "stance-adds", createdEmails);
    const setStance = (stance: string) =>
      researcher.supabase.from("stance_entries").insert({ cik: "9200000003", stance, note: "Looking closer" });

    await setStance("Avoid");
    expect(await onList()).toEqual([]);
    await setStance("Watching");
    await setStance("Candidate");
    expect(await onList()).toEqual([{ cik: "9200000003", change: "added", reason: "stance" }]);
  });

  it("adds it again through a Stance after the Researcher removed it", async () => {
    await withDb(stack, async (db) => {
      await db.query(`insert into public.research_list_changes (cik, change, reason) values ('9200000003', 'added', 'by_hand')`);
      await db.query(`insert into public.research_list_changes (cik, change, reason) values ('9200000003', 'removed', 'by_hand')`);
      await db.query(`insert into public.stance_entries (cik, stance, note) values ('9200000003', 'Candidate', 'Back on')`);
    });

    expect((await onList()).at(-1)).toEqual({ cik: "9200000003", change: "added", reason: "stance" });
  });

  it("only lets the Researcher add current members", async () => {
    const researcher = await createTestResearcher(stack, "adds-former", createdEmails);

    const former = await researcher.supabase
      .from("research_list_changes")
      .insert({ cik: "9200000004", change: "added", reason: "by_hand" });
    const current = await researcher.supabase
      .from("research_list_changes")
      .insert({ cik: "9200000003", change: "added", reason: "by_hand" });
    const asAnon = await anonClient(stack).from("research_list_changes").select("cik");

    expect(former.error).not.toBeNull();
    expect(current.error).toBeNull();
    expect(asAnon.data ?? []).toEqual([]);
  });
});
