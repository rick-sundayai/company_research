# Company Research

A personal research tool for the companies in the S&P 500. Every night it checks each member for signs that something has changed, such as earnings, a new SEC filing, a price move or a shift in analyst views. For each company where something has, it writes an evidence-only Brief. Each morning I read the night's Briefs and decide, one company at a time, which are worth owning individually and which to avoid.

It is a research aid, not an advisor. It never executes trades, and it never knows what I hold. It never recommends buying, selling or avoiding anything either: Briefs present evidence with its sources, and the decisions (Stances) are mine.

## Status

Design stage. The domain model and key decisions are written down; code comes next.

- [`CONTEXT.md`](CONTEXT.md): the glossary covering Company, Brief, Trigger, Stance, Source Check and the rest, along with the rules each one must keep
- [`docs/adr/`](docs/adr/): architecture decisions and why they were made

## How it is put together (planned)

- **Nightly job:** a scheduled GitHub Actions workflow in this repo ([ADR 0002](docs/adr/0002-nightly-job-on-github-actions.md))
- **Web app:** Next.js on Vercel, sign-in only, for one person
- **Data:** Supabase
- **Sources:** market data from Finnhub and company filings (10-K, 10-Q) from SEC EDGAR, with nothing filled in from general knowledge
- **Writing:** AI-written summaries, checked against the Brief's own facts before they are shown, under a $10/month cap

## Why the code is public but the app isn't

The running instance holds my own Stances and notes, and the market data comes from a free tier meant for personal use. So the code is open and the instance is private. A demo mode runs on made-up sample data about fictional companies ([ADR 0001](docs/adr/0001-separate-public-repo-private-instance.md)).

## Disclaimer

This is a personal project, not investment advice. Briefs are machine-written summaries of third-party data and may be incomplete or wrong.

## License

[MIT](LICENSE)
