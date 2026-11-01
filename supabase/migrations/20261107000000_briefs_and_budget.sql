-- Company Briefs and the Research Budget (CONTEXT.md, Company Brief and Research Budget).
-- Only the nightly job writes these; the Researcher reads them. A Brief is never edited or removed.

create table public.briefs (
  id bigint generated always as identity primary key,
  run_id bigint not null references public.nightly_runs (id),
  cik text not null references public.companies (cik),
  written_at timestamptz not null default now(),
  -- The Triggers that caused it, e.g. {earnings_reported, price_move}.
  triggers text[] not null check (cardinality(triggers) > 0),
  -- The price when it was written; a Brief caused by a non-routine Trigger (or the first Brief) is the
  -- baseline for the next price move.
  price numeric,
  -- Its facts beside their Sector Medians, what changed, the price since the Stance, news and sources.
  facts jsonb not null,
  -- The machine-written summary: bull case, bear case and open questions.
  summary text not null,
  model text not null
);
create index briefs_by_company on public.briefs (cik, id desc);

create function private.refuse_brief_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Briefs are never edited or removed; each is a record of what the app found that day'
    using errcode = 'P0001';
end;
$$;

create trigger refuse_brief_change
  before update or delete on public.briefs
  for each row execute function private.refuse_brief_change();

create trigger refuse_brief_truncate
  before truncate on public.briefs
  for each statement execute function private.refuse_brief_change();

-- The budget ledger: one row per AI call, with its estimate and its real cost.
create table public.ai_calls (
  id bigint generated always as identity primary key,
  -- The first day of the month the call counts against, YYYY-MM-01.
  month date not null check (extract(day from month) = 1),
  run_id bigint references public.nightly_runs (id),
  cik text references public.companies (cik),
  purpose text not null check (purpose in ('brief', 'filing_summary')),
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  estimated_cost_usd numeric not null check (estimated_cost_usd >= 0),
  cost_usd numeric not null check (cost_usd >= 0),
  called_at timestamptz not null default now()
);
create index ai_calls_by_month on public.ai_calls (month);

alter table public.nightly_runs add column briefs_written integer not null default 0;
alter table public.nightly_runs add column briefs_deferred integer not null default 0;

do $$
declare
  t text;
begin
  foreach t in array array['briefs', 'ai_calls'] loop
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
