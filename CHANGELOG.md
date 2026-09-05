# Changelog

A running record of what changed, why, and which bugs were found — written per
working session so the history stays legible without reading every diff.

Newest first. Each entry says what was **built**, what was **fixed**, and what
the work **exposed** — the third is usually the most useful, because the bugs
that surface while building something are the ones no test was ever going to
look for.

---

## Session 9 — position-aware framing, rank churn, three views

### Verified before starting

The three findings from the first live run were already committed in `d5c685d`
and confirmed present in the working tree:

| | status |
|---|---|
| Token buckets exist and are called by every provider | ✅ `twelvedata.ts` ×2, `tiingo.ts` ×1 |
| Bucket starts **empty** (no initial burst) | ✅ `allowBurst ? capacity : 0` |
| News relevance filter applied at ingestion | ✅ `finnhub.ts:214`, called with the company name from `aux-jobs.ts:111` |

### Fixed

- **Sign-out was unreachable in practice.** The endpoint worked (verified: brief
  returns 200 before, 401 after) but the only control lived at the bottom of
  `/watchlist`. A user on the brief had no way to leave. Sign-out now sits in
  the header of every signed-in page.
- **Client-side navigation kept a stale brief after sign-out.** `router.push`
  alone can serve a cached RSC payload; a `router.refresh()` precedes it.

### Also fixed while building

- **The shared nav existed on one page only.** Adding sign-out to the brief's
  header left `/watchlist`, `/performance`, `/replay` and `/admin/pipeline`
  with their own bespoke headers — so sign-out was still unreachable from four
  of six pages. All six now use `TopNav`.
- **Two sign-out buttons, one click apart.** `AccountControls` kept an ordinary
  "Sign out" beside "Sign out everywhere". Only the heavier action stays there;
  putting them adjacent invites the wrong one.

### Built

- **Position-aware framing.** `intent` was captured from the first version and
  only ever moved a score multiplier. It now changes the *sentence*: a name you
  hold that falls is a loss, the same fall on a name you are considering is a
  cheaper entry. Same number, opposite meaning.
- **Rank churn.** "NVDA was your top concern last visit; it is now 4th." Free
  from the cursor, and nothing else in the product tells you.
- **Three views**, because "what changed" and "what it means to me" are
  different questions:
  - `/` — the brief, ranked and budgeted, with position framing woven in
  - `/market` — everything at once, unranked and unfiltered
  - `/positions` — grouped by what you said you were doing with each name

---

## Session 8 — the path, and three things never wired in

### Built

- **The path, not just the endpoints.** Each card reports the high or low
  reached *during* the absence, when it was not today.
- **A one-line absence summary** before any card, every clause a count of
  something already computed.
- **An adjustable attention budget** (3–10) and a **sign-out control**.

### Fixed

- **The headline number was measured from the wrong baseline.** `windowStats`
  loaded a fixed 40 bars; a 75-day absence spans ~53 sessions, so the cursor
  bar fell off the end of the array and "since you looked" silently measured
  from the oldest bar loaded.
- **`seed-demo` never invalidated the cache**, so `demo:reset` did not reset
  what the page served.
- **`SitrepItem.isUpdate`** — declared, always `false`, never read.

### Exposed

- The first round-trip rule counted **16 of 17 names**. A clause true of nearly
  everything says nothing; it now requires an excursion both large and at least
  twice the net move.

---

## Session 7 — first live run

### Fixed

- **No rate limiting existed anywhere**, despite the plan claiming a token
  bucket per source. The intraday job stored **8 of 26 symbols** and reported
  success.
- **The first bucket still burst.** Starting full is right for an average-rate
  limit and wrong for a rolling window. Starting empty: 26/26, zero 429s.
- **News relevance.** Of 255 articles pulled, **51 mentioned the company they
  were filed under**. Now filtered on a word boundary — 20% → 88%.
- **News was ingested and never displayed**; **`invalidateUser` deleted a key
  nothing wrote**.

---

## Sessions 1–6 — summary

Engine, calibration, cursor, themes, narrative, replay, worker, ops page,
auth hardening, market-aware scheduling, gap repair, reconciliation audit
trail, Redis cache, briefing, historical context, general replay, and the
seven judgement calls. See `git log` for the full record; every commit message
states what it found as well as what it changed.
