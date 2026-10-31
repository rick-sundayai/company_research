# 0002: The overnight job runs on GitHub Actions; the web app runs on Vercel

**Date:** 2026-10-31  
**Status:** Accepted

## Context

Every night the app runs a Nightly Check across all ~500 current members and then writes Briefs for the Companies whose Triggers fired. The Finnhub free tier allows 60 calls a minute, so the Check alone takes at least nine minutes; with Filing downloads from EDGAR and AI writing, a busy night may run 20–40 minutes. The Researcher's laptop is asleep overnight, so the job has to run somewhere hosted, and the project is meant to cost nothing.

The web app runs on Vercel's free Hobby plan, and keeping everything on one platform was appealing. But on Hobby a single function stops after 300 seconds, so a 20–40 minute night would have to be rewritten as a Vercel Workflow: many short steps with pauses between Finnhub batches. That fits the free allowances (an estimated ~15k of 50k Workflow events a month), but going over pauses the feature for 30 days rather than billing, and the job code would be written in Vercel's step style.

GitHub Actions is free and unlimited on standard hosted runners for public repositories, and this repository is public (ADR 0001). Its catches are different: scheduled runs can be delayed or occasionally dropped at busy times, and a public repository's scheduled workflows are switched off after 60 days with no repository activity.

## Decision

The overnight job runs as a scheduled GitHub Actions workflow in this repository; the web app runs on Vercel Hobby, and both share the same Supabase project.

The job stays an ordinary long-running script that can be run and tested on a laptop, there is no free allowance to exhaust in the middle of the heavy first run, and the run history is visible on the public repository, which suits a project shown on a blog. Vercel Workflow was the alternative and would also have been free; it lost on portability and on what happens when an allowance runs out.

## Consequences

**Positive:**
- The job costs nothing and has no allowance to blow through; its code is plain and portable
- Every nightly run is visible in the public repository's Actions history
- The web app and the job can be deployed and debugged independently

**Negative / trade-offs:**
- Two platforms to configure: secrets (Supabase service key, Finnhub key, AI key) are held in GitHub as well as Vercel
- Scheduled workflows switch off after 60 days without repository activity; a monthly heartbeat commit is needed, and the app should flag a missed night
- Schedules can be delayed or dropped under load; the job is scheduled off the hour (e.g. 03:17 UTC) and tolerates a late start
- The job must use a full runner (`ubuntu-latest`); the single-CPU `ubuntu-slim` runner ends jobs after 15 minutes

**Neutral:**
- The Digest is "the latest overnight run", not "last night at a fixed time", so a late or skipped schedule changes nothing about what the Digest means
- A requested Brief waits for the next night; the workflow can also be started by hand from GitHub when one is wanted sooner
