# Changelog

A running record of what changed, why, and which bugs were found — written per
working session so the history stays legible without reading every diff.

Newest first. Each entry says what was **built**, what was **fixed**, and what
the work **exposed** — the third is usually the most useful, because the bugs
that surface while building something are the ones no test was ever going to
look for.

---

## Session 15 — the UI overhaul

Branch `ui-overhaul`. Scope was explicit: look and feel only — no backend, no
API, no engine, no schema, no auth. One read-path change was permitted and
taken. `npm run verify` staying at **83** is the evidence the boundary held.

### Built

- **A design system, used.** `globals.css` now carries elevation, radii,
  motion, glass and severity-tint tokens, plus a mesh-and-grain ground. The
  point is the second half: every ad-hoc panel and outlined control in the app
  was swept onto `.card` / `.glass` / `.btn`. A token layer nothing uses is a
  token layer that drifts.
- **`AttentionField`** — the product's argument as one picture. Every watched
  name is a point placed by attention score, with the budget line drawn across
  it; most of the field sits below the line, and that is the thesis. Bound to
  `sitrep.all`, so nothing on it is invented. 2D canvas, 30fps cap, paused
  off-screen, static under reduced motion.
- **`MarketPulse`** — SPY, QQQ and the seven sector proxies over the *same*
  window as the cards, from the same cached `windowStats`. A reader told NVDA
  fell 6% could not previously tell whether that was NVDA or was everything.
- **`Shell`** — a collapsible rail replacing the top bar, with the three views
  separated from the tools, collapse state persisted, and the same links
  rendered as a top bar below `lg`.
- **Route-level skeletons** shaped like the cards they replace, a lift chart on
  the track record, a tick-marked scrubber on replay, stat tiles on the
  pipeline page, and grouped columns on positions.

### Fixed

- **Unlayered CSS silently defeated Tailwind's positioning.** A rule lifting
  `main`/`aside`/`header`/`nav` above the ground set `position: relative`, and
  because everything in `globals.css` is unlayered it beat the `fixed` utility
  on the mobile navigation bar regardless of specificity. The bar dropped into
  normal flow and squeezed `<main>` to **40px**: below `lg` the app rendered as
  an empty screen. The ground sits at `z-index: -1` now and touches no
  element's position.
- **The attention field could render as blank space.** The canvas painted only
  from inside the animation loop, and the loop was gated on a `running` flag
  the `IntersectionObserver` could clear without ever being able to restore —
  one "not intersecting" report while the page was still settling left it off
  permanently. The picture is now drawn once, unconditionally, before any loop
  exists; the drift is decoration on top of it. **Decoration must never decide
  whether the data appears.**
- **The loading skeleton claimed the `main` landmark.** As a route-level
  Suspense fallback it is in the document at the same time as the page
  streaming in behind it — two `main` landmarks at once, invalid for assistive
  tech, and it broke two browser journeys that address the page by landmark.
  Found by the tests, fixed in the component rather than in the tests.
- **The lift chart rendered every bar one row below its label.** The baseline
  was a grid item spanning all rows, and the cell it occupied displaced the
  first bar. Rewritten so the marker lives inside each bar's own track, where
  it cannot desynchronise from what it measures.
- **The field scaled from zero**, squashing every point into the top third and
  hiding the gaps between names — which is the whole comparison. Now anchored
  to the range actually present.
- **The pulse strip overflowed** into a horizontal scrollbar across the hero
  with the last tile cut in half. A strip you have to drag is one nobody reads.
- **Positions left half the page empty** when only one intent was stated.

### Exposed

- **Two sparklines shared one gradient.** SVG ids are document-global, so a
  hardcoded id meant the second line silently took the first one's colours — a
  falling line drawn green. `useId` would fix it and would also make the module
  client-only, which it is not: server pages render sparklines directly. There
  are only ever two gradients, so they are named by direction.
- **An inline transform beats a stylesheet one.** The cursor tilt would have
  silently cancelled `.card-lift`'s elevation the moment the pointer moved, so
  the lift is composed into the same transform.
- **Reduced motion was honoured in three different places** — a global CSS
  rule, and two separate `matchMedia` checks. Guarantees spread across three
  mechanisms rot quietly, and the people they fail are the least likely to
  report it. Now covered by a test asserting the field is both *painted* and
  *byte-identical over time*: 12 browser journeys became **13**, deliberately.

### Verification

`tsc` clean · **227** unit tests · **13** browser journeys · **83**
infrastructure checks (30 + 12 + 27 + 14, unchanged) · clean production build.

---

## Session 14 — a position that vanished when the price was quiet

### Fixed

- **A stated position disappeared below a 2% move.** Reported from the product:
  TSLA set to HIGH priority and HOLDING, window narrowed to a week — and the
  brief did not say it was held. Reproduced exactly: TSLA moved **+1.53%**, and
  `frameForPosition` returned `null` under its 2% threshold, taking the chip
  and the sentence with it.

  The threshold conflated two different things. Whether a move is worth calling
  *good or bad news* depends on its size. Whether you **hold** something is a
  fact about you, and does not stop being true because the price was quiet — a
  card showing the position on four names and omitting it on the fifth reads as
  broken, not restrained.

  A quiet move now keeps its label, takes a neutral tone, and says the useful
  thing: *"You hold this. The price has barely moved since you last looked —
  1.5%, so whatever put this on your brief, it was not that."* Which is real
  information: the alert was about volume, not price.

- **A test encoded the bug.** `says nothing about a move too small to reframe`
  asserted the broken behaviour, so the suite defended it. Replaced with what
  should happen, plus a case covering every stated intent.

---

## Session 13 — a cursor you can rewind

### Built

- **"See a longer window"** on the watchlist page: set *since you last looked*
  back a week, a month, 75 days or six months. Backwards only — pushing a
  cursor forward would mark things seen that were never shown, which is the one
  thing it must never do.

  This is a real control, not a demo hack. It answers "I was away longer than
  you think" and "show me the quarter, not the week" — and it happens to make
  the product demonstrable on any dataset, live or committed, without running a
  seed script.

---

## Session 12 — live by default, and three bugs only a live run could find

A product whose premise is "what changed since you last looked" cannot
sensibly default to a dataset that never changes. Fixture mode still exists
so a keyless clone works — but it is now **detected, not declared**.

### Built

- **Mode is inferred.** No keys → committed history. Keys present → live.
  `FIXTURE_MODE` still overrides in both directions, for tests and for
  demonstrating without burning quota. A switch people must remember to flip is
  a switch that will be wrong.

### Fixed — all three found by running it live

- **The daily update was broken, on the most common case there is.** Gap repair
  asks for exactly the missing sessions, which for a routine daily update is a
  single day — and Twelve Data answers `start_date == end_date` with
  `400 "No data is available on the specified dates"` **even when that date has
  data**. The window is now padded four days either side; writes are idempotent
  upserts, so overlap costs nothing.
- **Tiingo was paced against a limit it does not have.** Its 50/hour is a
  quota, not a rolling per-minute rate, so starting the bucket empty cost 72
  seconds before the first request and would have made a daily update take
  **31 minutes**. Bursting is allowed there; it is not on Twelve Data.
- **Compute raced itself.** At concurrency 2, two wholesale replaces both
  cleared the scorecard and both inserted, and the loser died on
  `detector_scorecards_pkey`. Compute is single-flight now, *and* the write is
  an upsert — a write that is only correct because nothing else runs is a trap
  for whoever changes the concurrency next.

---

## Session 11 — auditing the plan against the code

Went through `rev 9` line by line. Most of it was built. **Five verification
claims were written in the plan and never actually tested**, and writing them
found three real bugs.

### Fixed

- **A Redis outage cost 5.1 seconds, not 250ms.** Every cache read is bounded
  at 250ms, which is correct and was not enough: a brief makes ~20 cache calls,
  so an outage was paid for twenty times over. A breaker now opens after three
  consecutive failures and reopens on its own. **5143ms → 805ms.**
- **`closeCache()` could hang forever.** `quit()` is graceful — it waits for the
  connection to be established before closing, and on a client that never
  connected it never resolves. Every check would pass and the process would
  hang at exit. `disconnect()` instead. This also took `npm run verify` from
  over two minutes (hanging) to **10.8 seconds**.
- **Custom replay ranges were unbounded** — the exact risk the plan named and
  never mitigated. Seven years renders in 1.6s but produces **1,305 steps**,
  and a player that advances one day at a time is not a replay at that length.
  Capped at 120 sessions, refused loudly rather than truncated silently.

### Tests written for claims the plan had only asserted

- a **real** Redis outage, rather than the disabled flag — different code path
- every cache key carries the engine version, and every key has a TTL
- a **three-week** outage heals in full, not just its last ten days
- a failed provider response never overwrites known-good data
- fixture mode genuinely serves from committed history

Infrastructure checks: 69 → **82**.

### Exposed

- The outage test failed first time for the wrong reason: it compared against a
  baseline captured before `markSeen` ran earlier in the same script. A stale
  expectation reported as a product bug.

---

## Session 10 — docs, the 40-bar residual, and an end-to-end pass

### Built

- **`project_description.md`** — what the product is, in plain language, for a
  reader with no finance or engineering background.
- **`run_commands_list.md`** — every command to run the project, from a zip and
  from GitHub, including Docker setup and a troubleshooting section.

### Fixed

- **The 40-bar residual, properly.** The previous fix raised the cap to 400
  bars, which moved the failure rather than removing it: an absence past the
  cap would land in exactly the same place. Nothing needed the window as an
  array — the baseline is one row, each extreme is one row, and the recent tail
  is only for volatility and the sparkline. Four small queries replace it,
  correct for an absence of any length. Verified against an independent
  calculation at 30, 75, 500, 1500 and 2200 days: **exact at every length**.

### Exposed by the end-to-end pass

- **Every card said "BOTTOMED".** The path was measured against today, so a
  name up 76% always reported a low far below — which is arithmetic, not
  information. Extremes are now measured against **where you left it**: a low
  below your baseline that recovered, or a high above today that eased back.
  Both are excursions the endpoints do not imply. 5 of 5 cards → 3 of 5, in
  both directions.
- **The summary's round-trip count went to 9 of 13** under the new rule. The
  card and the summary now use different thresholds on purpose: 5% is worth a
  line about one name, 15% is what a headline count needs to stay meaningful.
- **The positions view was nearly empty**, because the demo seeded an intent
  for 4 names out of 17 — a feature that works looking like one that does not.
  Now 12 of 17.
- **`HEDGE` could not be demonstrated honestly.** Nothing in this universe is
  a hedge: the sector ETFs are regression proxies rather than watchable
  instruments, and no equity is defensive. Labelling one would be a demo that
  lies about the data, so the framing stays unit-tested and unattached.

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
