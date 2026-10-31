-- The Researcher: the one person who can sign in to the running app (see CONTEXT.md).
-- Every table added later has row-level security, readable only by the signed-in Researcher;
-- the nightly job writes with the service role.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Emails permitted to sign in and become the Researcher. Not exposed through the API.
-- Kept in step with the ALLOWED_RESEARCHER_EMAIL setting (see README).
create table private.allowed_researcher_emails (
  email text primary key check (email = lower(email))
);

create table public.researchers (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);

alter table public.researchers enable row level security;
alter table public.researchers force row level security;

revoke all on public.researchers from anon, authenticated;
grant select on public.researchers to authenticated;

create policy "The Researcher can see only themselves"
  on public.researchers for select to authenticated
  using (id = auth.uid());

-- Refuse to create (or re-email) any auth user whose email is not allowed, so a direct
-- call to Supabase Auth with another email cannot produce a Researcher.
create function private.refuse_unallowed_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is null
     or not exists (
       select 1 from private.allowed_researcher_emails where email = lower(new.email)
     ) then
    raise exception 'This email is not allowed to sign in' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger refuse_unallowed_email
  before insert or update of email on auth.users
  for each row execute function private.refuse_unallowed_email();

-- First sign-in of an allowed email creates the Researcher.
create function private.create_researcher_for_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.researchers (id, email) values (new.id, lower(new.email));
  return new;
end;
$$;

create trigger create_researcher_for_new_user
  after insert on auth.users
  for each row execute function private.create_researcher_for_new_user();
