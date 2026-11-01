-- Requested Briefs: the Researcher asks for a fresh Brief on a Company, and the next run writes it
-- ahead of everything else in the Research Budget (CONTEXT.md, Trigger: requested).

create table public.brief_requests (
  id bigint generated always as identity primary key,
  cik text not null references public.companies (cik),
  requested_at timestamptz not null default now(),
  -- Set by the nightly job when the requested Brief is written and passes the Source Check.
  done_run_id bigint references public.nightly_runs (id),
  done_brief_id bigint references public.briefs (id)
);
-- At most one pending request per Company.
create unique index one_pending_request_per_company on public.brief_requests (cik) where done_run_id is null;

alter table public.brief_requests enable row level security;
alter table public.brief_requests force row level security;
revoke all on public.brief_requests from anon, authenticated;
grant select on public.brief_requests to authenticated;
grant insert (cik) on public.brief_requests to authenticated;

create policy "Only the Researcher reads Brief requests" on public.brief_requests
  for select to authenticated
  using (exists (select 1 from public.researchers r where r.id = (select auth.uid())));

create policy "Only the Researcher requests Briefs" on public.brief_requests
  for insert to authenticated
  with check (exists (select 1 from public.researchers r where r.id = (select auth.uid())));
