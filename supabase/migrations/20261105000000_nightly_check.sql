-- The Nightly Check: each run's snapshot of every current member, and the Sector Medians from it
-- (CONTEXT.md, Nightly Check and Sector Median). Only the nightly job writes these; the Researcher reads them.

-- One row per current member per run. Every figure is null when the provider has none ("not found").
create table public.company_snapshots (
  run_id bigint not null references public.nightly_runs (id),
  cik text not null references public.companies (cik),
  ticker text not null,
  price numeric,
  previous_close numeric,
  market_cap numeric,
  forward_pe numeric,
  peg numeric,
  gross_margin numeric,
  operating_margin numeric,
  revenue_growth numeric,
  debt_to_equity numeric,
  -- Monthly analyst rating counts as the provider gave them, newest month first.
  ratings jsonb not null default '[]',
  primary key (run_id, cik)
);
create index company_snapshots_by_company on public.company_snapshots (cik, run_id desc);

-- The median of each key fact across current members with a valid Sector and a figure for it.
create table public.sector_medians (
  run_id bigint not null references public.nightly_runs (id),
  sector text not null,
  fact text not null check (fact in (
    'forward_pe', 'peg', 'gross_margin', 'operating_margin', 'revenue_growth', 'debt_to_equity'
  )),
  median numeric not null,
  companies integer not null check (companies > 0),
  primary key (run_id, sector, fact)
);

do $$
declare
  t text;
begin
  foreach t in array array['company_snapshots', 'sector_medians'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy "Only the Researcher reads %s" on public.%I for select to authenticated
         using (exists (select 1 from public.researchers r where r.id = (select auth.uid())))',
      t, t
    );
  end loop;
end;
$$;
