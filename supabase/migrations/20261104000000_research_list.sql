-- The Research List: the current members the app writes Briefs about (CONTEXT.md, Research List).
-- Kept as dated additions and removals; a Company is on the list when its latest change is an addition.

create table public.research_list_changes (
  id bigint generated always as identity primary key,
  cik text not null references public.companies (cik),
  change text not null check (change in ('added', 'removed')),
  -- by_hand: the Researcher; stance: set to Watching or Candidate; first_run: the 100 largest at the first run.
  reason text not null check (reason in ('by_hand', 'stance', 'first_run')),
  changed_at timestamptz not null default now()
);
create index research_list_changes_by_company on public.research_list_changes (cik, changed_at desc, id desc);

-- Whether a Company is on the Research List now.
create function public.is_on_research_list(company_cik text) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(
    (select c.change = 'added' from public.research_list_changes c
      where c.cik = company_cik order by c.changed_at desc, c.id desc limit 1),
    false
  );
$$;

-- Changes are never edited or removed, not even with direct database access.
create function private.refuse_research_list_change_edit() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Research List changes are never edited or removed; add a new change instead'
    using errcode = 'P0001';
end;
$$;

create trigger refuse_research_list_change_edit
  before update or delete on public.research_list_changes
  for each row execute function private.refuse_research_list_change_edit();

create trigger refuse_research_list_change_truncate
  before truncate on public.research_list_changes
  for each statement execute function private.refuse_research_list_change_edit();

-- Setting a current member's Stance to Watching or Candidate adds it to the list, unless it is already on.
create function private.add_to_research_list_for_stance() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.stance in ('Watching', 'Candidate')
     and exists (select 1 from public.companies c where c.cik = new.cik and c.is_current_member)
     and not public.is_on_research_list(new.cik) then
    insert into public.research_list_changes (cik, change, reason) values (new.cik, 'added', 'stance');
  end if;
  return null;
end;
$$;

create trigger add_to_research_list_for_stance
  after insert on public.stance_entries
  for each row execute function private.add_to_research_list_for_stance();

-- Only the signed-in Researcher reads and changes the list, and adds only current members.
-- The database sets the date.
alter table public.research_list_changes enable row level security;
alter table public.research_list_changes force row level security;
revoke all on public.research_list_changes from anon, authenticated;
grant select on public.research_list_changes to authenticated;
grant insert (cik, change, reason) on public.research_list_changes to authenticated;
revoke execute on function public.is_on_research_list(text) from public, anon;

create policy "Only the Researcher reads the Research List" on public.research_list_changes
  for select to authenticated
  using (exists (select 1 from public.researchers r where r.id = (select auth.uid())));

create policy "Only the Researcher changes the Research List, adding only current members" on public.research_list_changes
  for insert to authenticated
  with check (
    exists (select 1 from public.researchers r where r.id = (select auth.uid()))
    and reason = 'by_hand'
    and (change = 'removed'
         or exists (select 1 from public.companies c where c.cik = research_list_changes.cik and c.is_current_member))
  );
