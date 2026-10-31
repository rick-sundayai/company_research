-- Local development only (`supabase db reset`); never applied to the hosted database.
-- The same fictional email as ALLOWED_RESEARCHER_EMAIL in .env.example.
insert into private.allowed_researcher_emails (email) values ('researcher@example.test')
on conflict do nothing;
