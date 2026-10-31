-- Companies, their tickers, and Index Membership as the nightly job sees it (CONTEXT.md, ADR 0003).
-- Only the nightly job writes these, with the service role; the Researcher reads them.

-- One row per overnight run. Later slices add their own results to it.
create table public.nightly_runs (
  id bigint generated always as identity primary key,
  run_date date not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  outcome text not null default 'running' check (outcome in ('running', 'succeeded', 'failed')),
  -- 'refused' is the guard against removing more than 10 current members; 'failed' means unreadable.
  membership_update text check (membership_update in ('applied', 'refused', 'failed')),
  membership_note text,
  error text
);

-- A Company is identified by its SEC company number (CIK).
create table public.companies (
  cik text primary key check (cik ~ '^[0-9]{10}$'),
  name text not null,
  -- One of the 11 GICS sectors, or null for "not found".
  sector text check (sector in (
    'Communication Services', 'Consumer Discretionary', 'Consumer Staples', 'Energy',
    'Financials', 'Health Care', 'Industrials', 'Information Technology', 'Materials',
    'Real Estate', 'Utilities'
  )),
  is_current_member boolean not null,
  first_seen_on date not null
);

-- A ticker belongs to at most one Company; each Company has exactly one primary ticker.
create table public.tickers (
  ticker text primary key check (ticker <> '' and ticker = upper(ticker)),
  cik text not null references public.companies (cik),
  is_primary boolean not null default false
);
create unique index one_primary_ticker_per_company on public.tickers (cik) where is_primary;

-- Dated by when the app first saw the Company join or leave, not by the index provider.
create table public.membership_changes (
  id bigint generated always as identity primary key,
  cik text not null references public.companies (cik),
  change text not null check (change in ('joined', 'left')),
  seen_on date not null,
  run_id bigint not null references public.nightly_runs (id)
);
create index membership_changes_by_company on public.membership_changes (cik, seen_on);

-- Companies are never deleted, not even by the job or with direct database access.
create function private.refuse_company_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Companies are never deleted; a Company that leaves the index becomes a former member'
    using errcode = 'P0001';
end;
$$;

create trigger refuse_company_delete
  before delete on public.companies
  for each row execute function private.refuse_company_delete();

create trigger refuse_company_truncate
  before truncate on public.companies
  for each statement execute function private.refuse_company_delete();

-- Readable only by the signed-in Researcher; no one but the service role writes.
do $$
declare
  t text;
begin
  foreach t in array array['nightly_runs', 'companies', 'tickers', 'membership_changes'] loop
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
