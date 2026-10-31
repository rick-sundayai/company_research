# 0001: Company Research is its own public repo, separate from finance-manager, with a private running instance

**Date:** 2026-10-31  
**Status:** Accepted

## Context

The Researcher wants to research the S&P 500 companies one at a time, with an overnight job gathering evidence, so they can pick individual stocks to own rather than only an index fund. They also want to show the project on GitHub and on their blog.

finance-manager, their existing private app, already has most of the plumbing this needs: Supabase, sign-in for a single person, a Finnhub key with a working adapter for forward P/E and PEG, and a Gemini key. Building research there would be the fastest route. But finance-manager's repository has to stay private: its history contains real personal financial data, and publishing it would mean rewriting that history.

Research and holdings are also different concerns. Research is about companies and could apply to anyone; holdings are private to one Owner. The research app's data includes the Researcher's Stances (Candidate, Avoid) and notes, which amount to their investment intentions. And the free Finnhub tier is for personal use, so republishing its figures on a public site is unlikely to be allowed.

## Decision

Company Research is built as a separate, public repository with its own Supabase project. It never receives holdings. Its running instance is sign-in only, for the one Researcher.

Separation is the only option that can be published without rewriting finance-manager's history, and it keeps public company research apart from private holdings. Making only the code public, not the running app, keeps Stances private and keeps Finnhub-derived data off the open web. The project is shown publicly through screenshots, a demo recording, and a demo mode that runs on made-up sample data.

finance-manager may later read Stances and Sectors from the research app by ticker, to show them beside holdings and help with diversification. That link is read-only and one-way, and it is not part of the first version.

## Consequences

**Positive:**
- The research code can be public from the first commit; no real holdings, Briefs or Stances are ever committed
- Research stays a general tool about companies, with nothing in it specific to the Researcher's holdings
- A small, focused repository is easier to explain in a blog post than a feature inside a larger app

**Negative / trade-offs:**
- Plumbing finance-manager already has is set up again: Supabase project, sign-in for a single person, Finnhub adapter, deployment
- Seeing research beside holdings waits for the later read link; until then the Researcher checks "held but marked Avoid" and diversification by hand
- Visitors cannot use a live public instance; the demo depends on sample data and recordings

**Neutral:**
- Terms both apps use mean different things: finance-manager's Security is a ticker, research's Company has one or more tickers; the later read link matches on any of a Company's tickers
- finance-manager's Valuation (forward P/E and PEG for stocks the Owner holds) stays as it is; research gathers its own figures for every S&P 500 member
