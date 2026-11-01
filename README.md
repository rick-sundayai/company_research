# Company Research

A personal research tool for the companies in the S&P 500. Every night it checks each member for signs that something has changed, such as earnings, a new SEC filing, a price move or a shift in analyst views. For each company where something has, it writes an evidence-only Brief. Each morning I read the night's Briefs and decide, one company at a time, which are worth owning individually and which to avoid.

It is a research aid, not an advisor. It never executes trades, and it never knows what I hold. It never recommends buying, selling or avoiding anything either: Briefs present evidence with its sources, and the decisions (Stances) are mine.

## Status

The v1 slices are built ([v1 spec](https://github.com/rick-sundayai/company_research/issues/1)): sign-in, Companies and Index Membership, Stances, the Research List, the Nightly Check with Sector Medians, Triggers and the Digest, Briefs within the Research Budget, the Source Check, Filings, the Gemini writer, requested Briefs and demo mode. The hosted instance still needs its keys and its first run.

- [`CONTEXT.md`](CONTEXT.md): the glossary covering Company, Brief, Trigger, Stance, Source Check and the rest, along with the rules each one must keep
- [`docs/adr/`](docs/adr/): architecture decisions and why they were made

## Running it locally

Needs Node 22, Docker and the Supabase CLI.

```bash
npm install
npm run db:start      # local Supabase on ports 56321–56329
npm run env:local     # writes .env.local from the running stack
npm run dev           # http://localhost:3200
```

Tests, all against the local Supabase with made-up data:

- `npm test`: the night runner (with fake sources), the database rules and the source adapters
- `npm run test:e2e`: the web app in a browser (Playwright)
- `npm run test:e2e:demo`: every page in demo mode carries the fictional-data label

CI runs all three on every push. `npm run test:contract` checks that the real services (SPY holdings, Wikipedia, SEC, EDGAR, Finnhub, Gemini) still return the shapes the adapters expect. It needs the keys in `.env.local`, costs a fraction of a cent, and never runs in CI.

### Signing in

Sign-in is by emailed link, and only for the single email in `ALLOWED_RESEARCHER_EMAIL`. Locally that is the fictional address in `.env.example`; read the link in the local mail catcher at http://localhost:56324. The first sign-in creates the Researcher. There is no sign-up.

The email is enforced twice:

- the sign-in action refuses any other email before contacting Supabase Auth
- a database trigger on `auth.users` refuses to create any user whose email is not in `private.allowed_researcher_emails`, so calling Supabase Auth directly with another email cannot create a Researcher

`supabase/seed.sql` allows the local email. On the hosted database (where the seed is not applied), insert the real email, lowercase, in the SQL editor, and set the same value as `ALLOWED_RESEARCHER_EMAIL` in Vercel:

```sql
insert into private.allowed_researcher_emails (email) values ('you@example.com');
```

### The nightly job

`npm run night` runs one night against the database in `SUPABASE_URL`: Index Membership, the Nightly Check of every current member (about 25 minutes at Finnhub's free-tier rate), Triggers, Filings and Briefs. It needs `SUPABASE_SERVICE_ROLE_KEY`, `FINNHUB_API_KEY`, `GEMINI_API_KEY` and `SEC_USER_AGENT` (a name and contact address, as the SEC asks); see `.env.example`.

The `Nightly Check` workflow runs it at 03:17 UTC and can be started by hand (optionally for a given date). It reads those values, plus `SUPABASE_URL`, from the repository's Actions secrets. A monthly `Heartbeat` workflow commits a timestamp so GitHub doesn't switch the schedule off.

### Demo mode

`DEMO=1 npm run demo:seed` fills an empty database with twelve nights of made-up data about fictional companies, by running the real night runner over fictional sources. Start the app with `DEMO=1` and every page says it is showing fictional sample data.

## How it is put together

- **Nightly job:** a scheduled GitHub Actions workflow in this repo ([ADR 0002](docs/adr/0002-nightly-job-on-github-actions.md))
- **Web app:** Next.js on Vercel, sign-in only, for one person
- **Data:** Supabase
- **Sources:** market data from Finnhub and company filings (10-K, 10-Q) from SEC EDGAR, with nothing filled in from general knowledge
- **Writing:** summaries by Gemini 3.5 Flash-Lite (paid tier, batched), checked against the Brief's own facts before they are shown, under a $10/month cap

## Why the code is public but the app isn't

The running instance holds my own Stances and notes, and the market data comes from a free tier meant for personal use. So the code is open and the instance is private. A demo mode runs on made-up sample data about fictional companies ([ADR 0001](docs/adr/0001-separate-public-repo-private-instance.md)).

## Disclaimer

This is a personal project, not investment advice. Briefs are machine-written summaries of third-party data and may be incomplete or wrong.

## License

[MIT](LICENSE)
