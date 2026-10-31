# AGENTS.md

## This repo is public

Never commit secrets, real Briefs, real Stances or notes, real tickers in sample data, or the Researcher's email. Read `git status` and the diff before every push. Commit and push only when asked. Nothing in `.scratch/` is ever committed.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `rick-sundayai/company_research`, which are public. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the default labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
