-- Stances: the Researcher's own judgement on a Company, kept as dated entries (CONTEXT.md, Stance).
-- The current Stance is the newest entry; a Company with no entries is Unreviewed.
-- Later slices link each entry to the Company's latest Brief at that moment.

create table public.stance_entries (
  id bigint generated always as identity primary key,
  cik text not null references public.companies (cik),
  stance text not null check (stance in ('Unreviewed', 'Watching', 'Candidate', 'Avoid')),
  note text not null check (btrim(note) <> '' and char_length(note) <= 500),
  set_at timestamptz not null default now()
);
create index stance_entries_by_company on public.stance_entries (cik, set_at desc, id desc);

-- Entries are never edited or removed, not even with direct database access; rethinking adds a new one.
create function private.refuse_stance_entry_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Stance entries are never edited or removed; add a new entry instead'
    using errcode = 'P0001';
end;
$$;

create trigger refuse_stance_entry_change
  before update or delete on public.stance_entries
  for each row execute function private.refuse_stance_entry_change();

create trigger refuse_stance_entry_truncate
  before truncate on public.stance_entries
  for each statement execute function private.refuse_stance_entry_change();

-- Only the signed-in Researcher reads and adds entries. They choose the Stance and note;
-- the database sets the date.
alter table public.stance_entries enable row level security;
alter table public.stance_entries force row level security;
revoke all on public.stance_entries from anon, authenticated;
grant select on public.stance_entries to authenticated;
grant insert (cik, stance, note) on public.stance_entries to authenticated;

create policy "Only the Researcher reads Stance entries" on public.stance_entries
  for select to authenticated
  using (exists (select 1 from public.researchers r where r.id = (select auth.uid())));

create policy "Only the Researcher adds Stance entries" on public.stance_entries
  for insert to authenticated
  with check (exists (select 1 from public.researchers r where r.id = (select auth.uid())));
