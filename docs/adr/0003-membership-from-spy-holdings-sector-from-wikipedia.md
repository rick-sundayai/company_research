# 0003: Index Membership comes from SPY's holdings, Sector from Wikipedia, Company grouping from the SEC

**Date:** 2026-10-31  
**Status:** Accepted

## Context

Every night the app needs the S&P 500's current members, grouped into Companies, each with its GICS Sector. S&P Dow Jones Indices does not publish the list for free, and Finnhub's index-constituents endpoint is not on the free tier (checked: it returns 403).

Free sources checked on 2026-10-31:

- **SPY daily holdings** (State Street, an `.xlsx` file): fetches cleanly from a script and lists every member's ticker, with share classes as separate rows. It has no Sector values.
- **Wikipedia's "List of S&P 500 companies"**: 502 rows with GICS Sector, sub-industry, CIK and date added. It is crowd-edited. On the day it was checked, one row's Sector was a sub-industry ("Interactive Media & Services") rather than one of the 11 sectors.
- **iShares IVV holdings**: returns an HTML page instead of the CSV to a script, so it was not usable.
- **SEC `company_tickers.json`**: the SEC's own mapping from ticker to CIK. Share classes of one company (GOOGL and GOOG) share a CIK.

## Decision

Membership comes from SPY's holdings, Sector from Wikipedia, and Company grouping from the SEC. Each fact comes from the most trustworthy free source that has it:

- SPY's holdings decide who is a current member. SPY is required to track the index, so its holdings are the membership.
- Wikipedia supplies only the Sector. A value is accepted only if it is one of the 11 GICS sector names; otherwise the Company keeps its last valid Sector, or "not found".
- The SEC's ticker list groups tickers into Companies by CIK. The same CIK is used to fetch Filings from EDGAR.

Wikipedia alone was the simpler alternative, since one page gives membership, Sector and CIK. It was rejected because a single bad edit could then add or drop Companies, and the Index Membership rules mean a Company that has joined is never deleted.

## Consequences

**Positive:**
- A crowd-edited page can mislabel a Sector, but it cannot change which Companies exist
- The CIK gives one identity for a Company across share classes and EDGAR

**Negative / trade-offs:**
- Three sources to fetch and parse, any of which can change format without notice; the job must fail loudly rather than treat an unreadable list as "everyone left the index"
- SPY's holdings can briefly differ from the index around a rebalance, and a cash or futures row must be ignored
- A new member may show Sector "not found" until Wikipedia lists it

**Neutral:**
- Index Membership is dated by when the app first saw the change, which already allows for a source that is a day behind the index provider's announcement
