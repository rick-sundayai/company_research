-- The Source Check (CONTEXT.md, Company Brief). Every new Brief is checked before it is saved; a Brief
-- that fails is kept, held back, with its reasons, and is never the latest Brief or in the Digest.
alter table public.briefs
  add column source_check text not null default 'passed' check (source_check in ('passed', 'held_back')),
  add column check_reasons text[] not null default '{}',
  add constraint held_back_briefs_have_reasons check (source_check = 'passed' or cardinality(check_reasons) > 0);

alter table public.nightly_runs add column briefs_held_back integer not null default 0;
