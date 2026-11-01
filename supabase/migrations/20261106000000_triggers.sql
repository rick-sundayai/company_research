-- Triggers: the reasons a Company gets a new Brief, as each night decided them (CONTEXT.md, Trigger).
-- The Digest shows the latest run's. Only the nightly job writes these; the Researcher reads them.

create table public.triggers (
  run_id bigint not null references public.nightly_runs (id),
  cik text not null references public.companies (cik),
  kind text not null check (kind in (
    'earnings_reported', 'new_filing', 'price_move', 'analyst_shift', 'no_brief_yet', 'requested', 'routine'
  )),
  -- Whether the Company was on the Research List that night: off the list, only price moves and
  -- analyst shifts are recorded, and they write no Brief.
  on_research_list boolean not null,
  -- What fired it, e.g. {"from": 100, "to": 88, "change": -0.12} for a price move.
  detail jsonb not null default '{}',
  primary key (run_id, cik, kind)
);
create index triggers_by_company on public.triggers (cik, kind);

alter table public.triggers enable row level security;
alter table public.triggers force row level security;
revoke all on public.triggers from anon, authenticated;
grant select on public.triggers to authenticated;
create policy "Only the Researcher reads triggers" on public.triggers
  for select to authenticated
  using (exists (select 1 from public.researchers r where r.id = (select auth.uid())));
