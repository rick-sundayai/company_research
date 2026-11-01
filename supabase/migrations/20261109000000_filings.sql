-- Filings: each Research List Company's 10-K and 10-Q on EDGAR, and its one-time summary (CONTEXT.md,
-- Company Brief). Only the nightly job writes these; the Researcher reads them.

create table public.filings (
  accession text primary key,
  cik text not null references public.companies (cik),
  form text not null check (form in ('10-K', '10-Q')),
  filed_on date not null,
  report_date date,
  url text not null,
  first_seen_run_id bigint not null references public.nightly_runs (id),
  -- False for the Filings already there when the app first looked (the Company had just joined the
  -- Research List); only a Filing that arrives later fires the new-Filing Trigger.
  fires_trigger boolean not null,
  -- Summarised once, then reused by every later Brief.
  summary text,
  summary_model text,
  summarised_run_id bigint references public.nightly_runs (id)
);
create index filings_by_company on public.filings (cik, filed_on desc);

alter table public.filings enable row level security;
alter table public.filings force row level security;
revoke all on public.filings from anon, authenticated;
grant select on public.filings to authenticated;
create policy "Only the Researcher reads filings" on public.filings
  for select to authenticated
  using (exists (select 1 from public.researchers r where r.id = (select auth.uid())));
