# Context: Company Research

Gathers evidence about the companies in the S&P 500 so the Researcher can decide, one company at a time, which are worth owning individually and which to avoid. It never executes trades and never knows what the Researcher holds.

**Related context:** Personal Finance (finance-manager, private) may later read Stances and Sectors from this context by ticker, to show them beside the Owner's holdings. The link is read-only and one-way: this context never receives holdings, and a held ticker matches a Company through any of its tickers, not only its primary one.

## Glossary

### Researcher

The one person who uses the app: reads Briefs and sets Stances. The app's code is public, but its running instance and its data belong to the Researcher alone.

**Invariants:**
- There is exactly one Researcher; only they can sign in to the running app
- Stances and their notes are seen by no one but the Researcher
- No real Brief or Stance is ever published with the code; anything shipped with the code is made-up sample data
- Sample data describes only fictional Companies with invented names and tickers, never a real company, and is always labelled as fictional wherever it is shown

### Company

A business that issues shares, researched as one unit however many share classes it has (e.g. Alphabet, with GOOGL and GOOG). It has one or more tickers, one of which is its **primary ticker**: the most liquid share class, used to look up its market data.

**Distinguishes from:** Ticker — a ticker is one share class's trading symbol; a Company may have several, and research is always about the Company.

**Invariants:**
- Every Company has exactly one primary ticker and may have further tickers
- A ticker belongs to at most one Company
- Briefs and Stances belong to a Company, never to an individual ticker
- A Company is identified by its SEC company number (CIK); tickers that share a CIK in the SEC's own ticker list are share classes of one Company

### Sector

The broad industry group a Company belongs to (e.g. Information Technology, Utilities), one of the 11 GICS sectors. Read from Wikipedia's list of S&P 500 companies, the only free source found that gives it, and never chosen by the Researcher (ADR 0003).

**Invariants:**
- A Company has at most one Sector at a time, and it is always one of the 11 GICS sector names
- A Sector read from the list that is missing or not one of the 11 names is ignored: the Company keeps its last valid Sector, or shows "not found" if it never had one
- A Company whose Sector is "not found" is left out of every Sector Median
- The Sector source never decides Index Membership

### Sector Median

The middle value of a fact (forward P/E, PEG, margins, revenue growth, debt) across all current members in a Sector, as of the latest Nightly Check. It gives each Company's figure its context: a multiple that is high for a utility can be low for software.

**Invariants:**
- A Sector Median is computed from current members only, never former members
- Companies with no figure ("none" or "not found") are left out of the median, never counted as zero
- Every key fact in a Brief is shown beside its Sector Median, which counts as a fact in that Brief

### Index Membership

Whether a Company is in the S&P 500: a **current member** or a **former member**. Learned from the daily holdings of the SPDR S&P 500 ETF (SPY), which holds every member (ADR 0003), and dated by when the app first saw the Company join or leave it, not by the index provider's announcement.

**Invariants:**
- A Company joins the app the first time it appears in the constituent list, starting Unreviewed; the Researcher is not asked to confirm
- A Company that leaves the index is kept as a former member with all its Briefs and its Stance; it is never deleted
- Only current members on the Research List get new Briefs
- A former member that rejoins becomes a current member again and continues its existing history
- If a night's list would remove more than 10 current members at once, it is treated as unreadable: membership stays as it was, the Digest says the membership update failed, and the Nightly Check still runs on the existing current members

### Research List

The current members the app writes Briefs about. It is a subset of the index: every current member is still checked each night and counted in its Sector Median whether or not it is on the list. The list decides only whether Briefs are written.

**Distinguishes from:** Index Membership — membership decides which Companies the app tracks; the Research List decides which of them get Briefs.

**Invariants:**
- Only a current member on the Research List gets new Briefs
- A Company off the list still shows its latest facts beside their Sector Medians, and keeps every Brief it already has
- The Researcher adds and removes Companies by hand; a Company joining the index is not added automatically
- Setting a Company's Stance to Watching or Candidate adds it to the list at that moment; the Researcher may still remove it later
- At the first run the list starts as the 100 largest current members by market cap; this is a starting point, not a judgement on any Company

### Company Brief

The evidence gathered about one company in one research run, dated by when the run happened. It holds the company's facts (sector, size, revenue and earnings trend, margins, debt, valuation multiples), what changed since the previous Brief, and a written summary of the bull case, the bear case and open questions.

**Distinguishes from:** Stance — a Brief is what the app found; a Stance is what the Researcher decided.

**Invariants:**
- A Company Brief is produced by the app, never edited by the Researcher
- Every Brief is dated by its research run; a later run produces a new Brief rather than changing an old one
- A Brief never contains a buy, sell or avoid recommendation, score or rating; it presents evidence only
- Every claim in a Brief's written summary rests on facts in that Brief, and names the source it came from
- A Brief draws only on two sources: the market data provider (Finnhub: prices, metrics, earnings, analyst views, news headlines) and the Company's Filings; nothing is filled in from general knowledge or the open web
- Where a source has nothing, the Brief says "not found" rather than guessing
- Every Brief names the Trigger that caused it

### Source Check

The automatic check every new Brief must pass before it can be shown: every source its summary cites is present in the Brief, and every number its summary mentions matches a fact in the Brief. A Brief **passes** or is **held back**.

**Invariants:**
- Only a Brief that passed its Source Check can be a Company's latest Brief or appear in the Digest
- A held-back Brief is kept with its reason for the Researcher to inspect; the Company keeps its previous Brief, and the Digest says how many were held back
- A held-back Brief is retried the next night, counting against the Research Budget; after two consecutive failures it is not retried, and the Company is flagged for the Researcher
- Passing the Source Check means the summary's numbers and sources are faithful, not that its interpretation is right; the Brief says its summary is machine-written

### Filing

A report the Company files with the SEC, as published on EDGAR: the annual report (10-K) or a quarterly report (10-Q). The Company's own account of its business, risks and results.

**Invariants:**
- A Filing is used as published and never altered
- A new Filing since the last Brief is a Trigger

### Nightly Check

The overnight look at every current member for signs that something has changed: its price, key metrics, earnings calendar and analyst views. A Nightly Check writes no Brief by itself; it decides which Companies get one.

**Distinguishes from:** Company Brief — the Check is a quick scan of all current members; a Brief is the full write-up of one Company.

**Invariants:**
- Every current member is checked every night, whether or not it is on the Research List; former members are not checked
- A Trigger on a Company off the Research List writes no Brief; a price move or analyst shift on one is named in the Digest

### Trigger

The reason a Company gets a new Brief: **earnings reported**, **new Filing**, **price move** of 10% or more either way, **analyst shift** (the share of analysts rating it a buy moved by 10 points or more in a month), **no Brief yet** (the Company is on the Research List but has no Brief, e.g. it was just added), **requested** (the Researcher asked for a fresh Brief on this Company), or **routine** (the latest Brief is 7 days old with no other Trigger).

**Invariants:**
- A Company gets a new Brief only when it is on the Research List and at least one Trigger fires
- The latest Brief of a Company on the Research List should be no older than 7 days (routine Trigger); this yields to the Research Budget, and any Company past it is flagged in the Digest
- News alone is never a Trigger; news is summarised inside a Brief
- For a Company on the Research List, a price move is measured from the price at its latest Brief caused by a non-routine Trigger (or its first Brief); routine Briefs never reset that baseline, so slow drifts accumulate until they cross 10%
- For a Company off the Research List, which has no baseline Brief, a price move is a change of 10% or more either way in a single day
- An analyst shift compares the share of analysts rating the Company strong buy or buy with the previous month's share, on and off the Research List alike; it fires on a change of 10 percentage points or more, and only for a Company with at least 5 analysts
- The current month's share can change as analysts update their ratings, so it is compared each night with the previous month's, and an analyst shift fires at most once per calendar month for each Company
- Every Brief shows the price change since the Researcher's latest Stance entry, where there is one

### Research Budget

The most the app may spend on AI writing in a calendar month: $10, a hard cap.

**Invariants:**
- Spending never exceeds the month's Research Budget; once it is reached, no more Briefs are written until the next month
- Briefs that could not be written are deferred, and the Digest says how many
- When the budget cannot cover every Trigger, Briefs are written in this order: requested Briefs and Companies the Researcher has marked Candidate or Watching; earnings reported or new Filing; price move or analyst shift; no Brief yet; routine
- Each Filing is summarised once, when it arrives, and that summary is reused by later Briefs
- The first run, which needs a Brief for every Company on the Research List, is spread across nights within the budget, largest Companies by market cap first (requested ones jump the queue); the Nightly Check still covers every current member from the first night

### Digest

The Briefs written by the latest overnight run, grouped by Trigger, with Companies the Researcher has marked Candidate or Watching shown first, followed by the Companies off the Research List that had a price move or analyst shift that night. It is what the Researcher reads each morning.

**Distinguishes from:** Company Brief — the Digest is a view of one night's Briefs across Companies; it holds no evidence of its own beyond the Triggers that fired.

**Invariants:**
- The Digest contains only Briefs and Triggers from the latest overnight run
- A Company off the Research List appears only for a price move or analyst shift, named with that Trigger and no Brief, and can be added to the list from there; its earnings and Filings are never shown
- A night with no new Briefs produces an empty Digest that says so, not the previous night's

### Stance

The Researcher's own judgement on a company: **Unreviewed**, **Watching**, **Candidate** or **Avoid**, with a short note saying why.

**Invariants:**
- Only the Researcher sets a Stance; the app never sets or suggests one
- Every company starts Unreviewed
- A Stance stays put when new Briefs arrive; only the Researcher changes it
- Every change of Stance is kept as a dated entry with its note and the Company's latest Brief at that moment; together the entries form the Company's Stance history
- A Stance entry is never edited or removed; correcting or rethinking one adds a new entry
- A Company's current Stance is its most recent entry
