# SITREP

**Your market, since you last looked.**

A watchlist built around one question: *what meaningfully changed since I last checked, and what deserves my attention now?*

Not a dashboard. A briefing.

---

## Run it

No API keys needed. Real market data is committed as fixtures.

```bash
docker compose up -d          # postgres on 5433, redis on 6380
npm install
npx prisma migrate dev
npm run demo:reset            # seed, load fixtures, compute events, plant a cursor
npm run dev
```

Open http://localhost:3000 and sign in as `demo@sitrep.local` / `sitrep-demo-2026`.

| Page | What it shows |
|---|---|
| `/` | The SITREP — what changed since your cursor |
| `/replay` | Step two real historical windows one trading day at a time |
| `/watchlist` | Manage names, priority, and intent |
| `/admin/pipeline` | Ingest runs, data quality, engine version |

```bash
npm test              # 225 unit tests, engine + ingestion
npm run test:e2e      # 4 Playwright journeys through a real browser
npm run calibrate     # replay history, rewrite docs/calibration.md
npm run verify        # 69 checks: requirements, auth, ingestion, cache
```

### Background ingestion (optional, needs API keys)

```bash
npm run worker                                    # consumes the queues
curl -X POST localhost:3000/api/cron/ingest      -H "authorization: Bearer $CRON_SECRET"      # enqueues all 26 symbols
```

The route only **enqueues** — it returns in milliseconds regardless of how slow
or rate-limited the upstream feeds are, and never does provider I/O on a
request thread. The worker paces itself against the free tiers (Twelve Data
8/min, Tiingo 50/hour), retries with a long backoff because the real failure is
an hourly quota rather than a transient blip, and when the batch drains it
enqueues **one** recompute — not one per symbol, because a name's features
depend on the benchmark and sector proxies and computing mid-batch would read a
half-updated universe.

---

## The seven judgement calls

The brief leaves six decisions to the candidate. Each answer below says what is built **and what is not**, because the gaps are what make the rest believable.

### 1. What counts as meaningful change?

Six of the eight detectors give the obvious answer: *the price did something unusual*. The last two do not, and they are the real answer.

**`correlation_break`** — a name that tracked its sector at 0.85 for six months and now tracks it at 0.15 has changed in a way no price move describes. The move may be small, or absent, while the thing the position actually depended on has gone.

**`quiet_regime`** — the only detector that fires on the *absence* of movement. A name compressed into the quietest 5% of its own year is not "nothing happening": low realised volatility is the precondition for expansion.

Both are the best-performing detectors in the engine (1.70× and 1.53× over baseline). That was not the argument for building them; it is the argument for keeping them.

The sharper claim: **meaningful is relative to the observer.** `move_since_last_seen` divides by `σ·√Δt`, so the same market produces a different event for someone who checked yesterday than for someone who checked last month. No fixed threshold can express that.

**Beyond equities** — the engine needs only OHLCV plus a benchmark and a peer proxy, so it is asset-agnostic in principle. The honest test is **crypto**, because it *breaks* assumptions rather than reusing them: `sessionsSinceLastSeen` counts trading days and would have to become elapsed time; `MIN_HISTORY` and `BETA_WINDOW` are session counts; and `earnings_upcoming` has nothing to fire on. Designed, deliberately not built — naming the three breakages is worth more than a half-migrated ticker.

### 2. What information to surface

An attention budget of five, severity bands, *Why not higher*, a per-detector track record, themes, a rule-based narrative, and a chronology of the absence.

The argument: **the product is defined by what it refuses to show.** Calibration tunes to 1.49 surfaced instrument-days per name per month — a number chosen so a typical brief is about three items rather than twenty. Four populations are counted separately and never folded together:

| | means |
|---|---|
| below your attention budget | the engine flagged it; the budget cut it (adjustable, 3–10) |
| within normal range | the engine looked and found nothing |
| snoozed | *you* silenced it; still pending |
| came and went | it happened and resolved while you were away |

### 3. How state persists across sessions and devices

`UserWatchState(userId, instrumentId)` holds `lastSeenAt` and `cursorVersion`, server-side.

- **Loading the brief never advances the cursor.** A glance on a phone cannot wipe the brief waiting on a laptop.
- **Mark seen and snooze are different operations.** One moves the cursor; one deliberately does not.
- **Recency decay runs from the cursor, not the clock.** Every event past the cursor is unseen *by definition*.

**Not built:** `cursorVersion` exists for optimistic concurrency and **nothing currently sends it**, so the 409 path is unexercised. It is a schema affordance, not an enforced guarantee.

### 4. Stale, delayed and conflicting data

- Two providers reconciled onto **one adjustment basis** — the mismatch that produced 68,733 phantom conflicts before being fixed, now 8 real ones in 33,616 bars.
- **`unconfirmed` ≠ `single source`.** Sources disagreeing is a different claim from only one reporting.
- **Sanity can overrule trust**, but only when the trusted value is impossible *and* the alternative is plausible — judged against the instrument's own recent closes and its own typical move, never a fixed percentage. Every resolution records why.
- **Staleness is measured in trading sessions.** `now − lastBar > 24h` flags every Saturday, which trains a user to ignore the warning by the time it is true.
- **Late data is a new row, not an UPDATE.** Corrections are visible as corrections.
- **A failed fetch never overwrites known-good data.** An absence of information is not evidence that what is stored is wrong.

### 5. How it scales

Features, events and themes are computed **once per instrument** and shared; a SITREP is an `O(watchlist)` filter over rows that already exist. Adding users adds reads, never analytical work. The per-instrument window statistics — the actual `O(watchlist)` cost — are cached, with generation invalidation rather than TTL guessing.

**The limits, because a reviewer will find them:** compute is a **full recompute**, correct and idempotent but `O(universe × history)` per run; the incremental path is designed and deliberately deferred, because a rolling 120-day correlation that is not invalidated correctly produces a silently different answer. And every number here was measured at **26 instruments and one user**.

### 6. Simple vs complex

Complexity was bought for the engine, calibration, reconciliation, and the cursor. It was refused for: no LLM in the conclusion path, no learning loop, no SSE or WebSocket, no tick data, no IEX-only feed, a rule-table narrative, eight detectors rather than twenty.

The line: **complexity went where being wrong is expensive and invisible.** A wrong score is invisible. A wrong colour is not.

### 7. Data provenance

For a product whose thesis is explainability, an unsourced number is a contradiction.

| | comes from |
|---|---|
| Market prices | Twelve Data (primary) and Tiingo (secondary), reconciled |
| Resolved values | the validation and reconciliation layer, with a stored reason code |
| Intraday timing | Twelve Data 15-minute bars, 30-day retention, **never analytical** |
| Earnings | Finnhub, forward calendar only |
| News | Finnhub, live only — ~2 days of history |
| Historical context | a **curated** table, every row carrying a source |
| Signals and scores | the deterministic engine, version-stamped |
| Ranking | SITREP scoring, under the user's own priority and intent |

---

## Three views, three questions

The same data, three ways, because "what changed", "what is going on" and "what does this mean for me" are not the same question and one screen answering all three answers none well.

| view | question | opinion applied |
|---|---|---|
| `/` **brief** | what changed since I last looked? | ranked, and cut to the attention budget |
| `/market` **everything** | what is going on? | ranked, **nothing hidden** — the budget's cut is shown as dimming, not omission |
| `/positions` | what does this mean for me? | grouped by declared intent, every move reframed |

**Position-aware framing** is the one that changes what the product is. `intent` was captured from the first version and only ever moved a score multiplier — but a move does not mean one thing:

```
HOLDING          "You hold this. It is worth 8.0% less than when you last looked."     adverse
CONSIDERING_BUY  "You were considering buying. It is 8.0% cheaper than when you        favourable
                  last looked."
HEDGE            "This is a hedge. It lost 6.0% — cover costs something in a calm      neutral
                  market, and that is the trade."
```

Same number. Opposite news. A falling hedge is neither good nor bad, and calling it either would be wrong.

**No position size, no cost basis, no P&L, ever.** The product never asks what you own and must not imply it knows. Intent is a declaration, not a brokerage link, and every sentence stays true without knowing how much — asserted by a test that scans every rendered row.

**Rank churn** appears on the card: *▲ 4 → 1*. Recorded when you acknowledge a brief, never when you read one — reading must not write, because that rule is what makes a glance on a phone safe.

---

## The problem with watchlists

A normal watchlist is **stateless**. Every visit looks the same whether you were away an hour or a month, so it cannot tell you what is new *to you*. It ranks by percent change, which conflates a 3% wobble on a volatile small-cap with a 3% post-earnings gap on a mega-cap. It shows every row, so you do the filtering. And when it does alert you, it cannot say why.

SITREP inverts each of those.

| Normal watchlist | SITREP |
|---|---|
| Same view every time | **Per-user cursor** into an event timeline |
| Ranks by % change | Ranks by **anomaly**, normalised to each instrument's own volatility |
| Shows everything | **Attention budget** — top few, the rest collapse |
| Alert with no rationale | **Why am I seeing this?** *and* **Why not higher?** |
| Stale data shown as live | Every price carries freshness; disputed prices are capped |

---

## How it decides what matters

```
bars → features → detectors → scoring → themes → narrative → SITREP
```

**Eight detectors.** Move since you last looked (the only user-relative one), volume spike, sector divergence, range break, volatility regime shift, upcoming earnings — and two that answer a different question entirely.

### What counts as meaningful change?

The brief leaves that to the candidate, and six of the eight detectors give the obvious answer: *the price did something unusual.* The last two don't.

**`correlation_break`** — has this name stopped behaving like its peers? A stock that tracked its sector at 0.85 for six months and now tracks it at 0.15 has changed in a way no price move describes. The move may be small, or absent, while the thing the position actually depended on has gone. Two gates: the relationship must have existed (0.6 baseline) before it can break, and the fall must be large (0.45).

**`quiet_regime`** — the only detector that fires on the *absence* of movement. A name compressed into the quietest 5% of its own trailing year is not "nothing happening": low realised volatility is the precondition for expansion. Two gates again, and the second is what makes it news — the name must have *gone* quiet, not merely be quiet. A permanently sleepy stock would otherwise republish the same non-event every session.

Both are **directionless** (`direction: 0`). Decoupling and stillness are claims about structure, not about which way something went, so neither can be counted as evidence that a sector is under selling pressure — `detectThemes` excludes them, and a test pins that.

They are also, as it happens, the two best-performing detectors in the engine (1.53× and 1.70× over baseline — see below). That was not the argument for building them, but it is the argument for keeping them.

**The score is a transparent linear model.** Every point traces to a named signal:

```
score = 100 × strength × coverage^0.25 × context multipliers
```

- **strength** — weighted mean of the families that reported, so a lone extreme move is not punished for the silence of others
- **coverage** — how much of the total weight reported at all, so *corroboration counts*. Volume confirming a price move is worth more than either alone.
- **multipliers** — data quality, confirmation, recency, your explicit priority, your stated intent. All emitted as named contributions, never applied invisibly.

That is what makes the Why panel possible. It is not a rationalisation generated after the fact — the bars *are* the arithmetic.

**Why not higher** is the half that matters. Any ranking system can list the evidence it accepted; showing what it rejected, and by how much, is far harder to fake:

```
NVDA — 93
✓ outperforming its sector by +7.6% (3.4σ)     +29
✓ +8.7% over session (3.1σ)                    +23
✓ Volume 2.7× the 20-day median                +22
✓ You marked this name High priority          ×1.30
WHY NOT HIGHER
✕ Only 3 of 5 signal families fired           ×0.88
```

---

## Calibration: the thresholds are measured, not guessed

`npm run calibrate` replays the entire chain over real history and measures what would actually have been surfaced. Full report in [`docs/calibration.md`](docs/calibration.md).

| Metric | Value |
|---|---|
| Surfaced instrument-days per name per month | **1.06** (target 1–2) |
| Items in a typical brief | **2.1** (attention budget 5) |
| CRITICAL share of active days | **1.2%** |
| Follow-through vs look-every-day baseline | **1.31×** |

The target is derived from brief size, not picked: for 17 names checked twice weekly, a rate of R puts `17R/8.7` items in a brief. 0.7 feels empty; 2.5 hits the budget every visit.

**The first run said the engine was badly tuned**, and fixing it took three corrections worth reading as a record of what calibration is *for*:

1. The squash curve mapped a 2σ move — 5% of sessions — to 58 points. **26% of all events rated CRITICAL.**
2. Full weight renormalisation meant any detected event automatically cleared WATCH. `volume_spike` and `move_since_last_seen` surfaced **99.5%** of everything they detected, with no gradation at all. The score measured only the strongest evidence and ignored how *much* there was — silently discarding the product's own thesis.
3. The metric itself was wrong. Coverage is only meaningful at the instrument-**day** level, which is also what the brief ranks. And the original 2–4/month target was unreachable: detectors only fire on 2.35 days/name/month, so it implied showing everything.

Follow-through lift went from 1.03× to 1.31×.

---

## Does this thing actually work?

`/performance` publishes the engine's own hit rate, per detector.

```
detector             fired  surfaced  followed through   baseline   vs baseline
vol_regime_shift       374        83   7.2%  n=83          15.1%      0.48×  WORSE THAN CHANCE
move_since_last_seen   517       471  16.3%  n=471         15.2%      1.08×
sector_divergence      989       709  17.1%  n=709         15.2%      1.13×
volume_spike           568       560  18.1%  n=559         15.2%      1.19×
range_break          1,201       399  18.3%  n=399         15.2%      1.21×
quiet_regime           761       348  23.3%  n=348         15.2%      1.53×
correlation_break      250        43  25.6%  n=43          15.1%      1.70×
```

A warning "followed through" when the name moved ≥1.5σ within 3 sessions. Three rules make the page worth having:

- **Sorted worst-first.** A scorecard that leads with its best number is marketing.
- **Sample size beside every rate.** A 100% hit rate on n=3 is not a hit rate; below n=30 nothing is shown at all.
- **The baseline is the same test applied to every trading day.** Without it a rate means nothing — a detector that fires constantly scores well while saying nothing.

`vol_regime_shift` currently does *worse than looking every day*. It stays on the page. That it is still there is the clearest evidence the measurement isn't being tuned to flatter the engine; the honest options are to raise its threshold or delete it, not to stop measuring.

The same figures appear inline in the Why panel, next to the reason they qualify: *"outperforming its sector by +7.6% (3.4σ) — preceded a real move 17% of the time (n=709), 1.13× baseline."*

**This is a proxy, not ground truth.** Nobody labelled these events, and "did the user care?" is unmeasurable before the product has users. It tests one thing: whether an alert carried information about the near future rather than restating noise that had already passed. `earnings_upcoming` is absent because the free data tier serves forward-looking dates only.

**Deliberately not fed back into the scorer.** Tuning weights on the metric used to judge them would make the calibration unfalsifiable.

`followThroughRate` lives in `src/engine/followthrough.ts` — pure, and shared by the calibration report and the scorecard, so the two can never disagree about what "right" means.

---

## Themes: knowing when *not* to group

Ten alerts saying "semiconductor stock down" is ten times the noise and none of the insight. A theme says what a person would say: *your semis are selling off together, and the market is not.*

Confidence is four stored components, not one opaque number:

```
confidence = 0.35·cohesion + 0.20·timing + 0.20·size + 0.25·distinctness
```

**`distinctness` is a gate, not a vote.** On a day when everything falls, every sector looks like a theme — cohesion, timing and size alone score ~72, clearing any reasonable confidence floor. A move the market explains is not a *weak* sector story; it is *not a sector story at all*. So being specific to the group gets a veto.

The two replay scenarios exist to prove exactly this:

| Scenario | Result |
|---|---|
| **Semis selloff**, 2025-01-27 | Theme fires — 78% distinctness. Narrative: semis *led* a broader decline. |
| **COVID crash**, 27 days of 2020 | **Zero themes.** Narrative: broad market decline. |

Membership also requires a **magnitude** test, not just direction. QCOM closed −0.5% on 2025-01-27 while its sector fell double digits; the sign matched, but the name did not participate, and listing it contradicted its own card, which correctly said it *outperformed*.

---

## Data quality is a first-class feature

Two independent providers, reconciled on every bar.

- Agree within tolerance (0.3% price) → take the higher-trust value, fully confirmed
- Disagree beyond it → keep both, mark **unconfirmed**, degrade confidence with the size of the gap, cap severity so a disputed price can never produce a CRITICAL
- Only one source reported → use it at 0.9 confidence, **confirmed but uncorroborated**

Those last two are different things and the UI says so differently. Collapsing them told users "sources disagree" when only one source had reported — which was simply false.

Volume disagreement is recorded but never marks a bar unconfirmed: vendors legitimately differ on consolidated vs primary-listing volume, and flagging every bar would train people to ignore the badge.

Across the committed dataset that leaves **8 genuine conflicts in 33,616 bars** (0.02%), and 3 bars where the two providers disagree enough to be marked unconfirmed.

**Reconciliation initially reported 68,733 conflicts across 49,714 bars.** It was not finding data problems — it was comparing different units. Twelve Data's close is split-adjusted; Tiingo's is raw; Tiingo's `adjClose` is split *and* dividend adjusted. Every name that had ever split showed ~90% "disagreement" across its pre-split history. Reconstructing Tiingo onto Twelve Data's exact basis using its per-row `splitFactor` brought it to **20 conflicts**.

> A reconciliation system that does not first establish a common unit will confidently report unit mismatches as data quality problems — which is worse than not reconciling at all.

---

## The cursor

`UserWatchState(user, instrument)` holds `lastSeenAt`. Everything "since you last checked" is a range query from there.

- **Loading the brief never advances it.** Otherwise glancing on a phone would silently wipe the brief waiting on a laptop.
- **Recency decay runs from the cursor, not the clock.** Every event past the cursor is unseen *by definition*. Decaying from `now` meant a 5σ move three days into a ten-week absence hit the floor and was filed as noise — precisely what the user came back to learn.
- **The path, not just the endpoints.** "Up 5.5% since you looked" and "up 5.5%, having been 19% higher three weeks ago and given it all back" are the same two numbers describing completely different fortnights. Each card reports the high or low reached *during* the absence, when it was not today.
- **One line before any card.** *"In 53 trading sessions: 6 names moved more than 20% and 2 went materially further than they finished."* Every clause is a count of something already computed — no adjectives, because nothing generates one.
- **Window moves, not daily moves.** "NVDA is down 0.4% today" hides what actually happened: down 8% since you last looked.

**Two ways to clear a card, and they are not the same operation.** *Mark seen* means "I have absorbed this" and moves the cursor, so the next brief measures from now. *Snooze* means "not now" and moves nothing — the window keeps growing and the event returns, with its original timestamp, when the snooze lapses. Conflating them would quietly destroy the thing the product is built around.

The brief therefore reports **three** distinct populations, never folded together:

| | means |
|---|---|
| below your attention budget | the engine flagged it; the budget cut it (adjustable, 3–10) |
| within normal range | the engine looked and found nothing |
| snoozed | *you* silenced it; still pending, not cleared |

Calling any of these "quiet" would misreport what the engine found, which a product built on filtering cannot afford. Snoozing the last live item shows *"Nothing new"*, not *"your market is quiet"* — the second is a claim about the market that the engine never made.

---

## Architecture

```
   cron ──▶ POST /api/cron/ingest ──▶ [ BullMQ: ingest ] ──▶ worker
                                                              │
                    ┌──────────────┐   ┌──────────────┐       │
   Twelve Data ────▶│   validate   │──▶│  reconcile   │──┐◀───┘
   Tiingo      ────▶│              │   │              │  │
   Finnhub (cal)    └──────────────┘   └──────────────┘  │
                                                          ▼
   ┌───────────────────────────────────────────────┐   Postgres
   │  COMPUTE — once per instrument, for everybody │◀──  bars
   │  [ BullMQ: compute ] — one job per drain      │
   │  features → detectors → scorer → themes       │──▶  events
   └───────────────────────────────────────────────┘     themes
                                                          │
   ┌───────────────────────────────────────────────┐      │
   │  SITREP — per user, at read time              │◀─────┘
   │  cursor → filter → re-weight → rank → budget  │
   └───────────────────────────────────────────────┘
                          │
                     Next.js SSR
```

**The invariant:** features, events and themes are computed **once per instrument** and shared. A user's SITREP is an `O(watchlist)` filter over rows that already exist. Adding users adds fan-out and reads — never analytical work.

The engine (`src/engine/`) is **pure**: no database, no network, no clock. That is what makes it unit-testable against synthetic fixtures, replayable over history, and safe to version-stamp. Calibration, live compute and scenario replay all run the *same* code path — if calibration used a different one, its tuned thresholds would describe a system that was never shipped.

**Stack:** Next.js 16 (App Router, SSR) · TypeScript · Postgres 16 + Prisma 7 · BullMQ on Redis · Tailwind 4 · Vitest · Docker Compose.

The web process only enqueues; the worker does all provider I/O and compute. Redis is **not** on the read path — if it is down the brief still renders and the ops page says so, because a queue that can take the product offline is worse than no queue.

---

## Point-in-time correctness

Replay is only honest if the engine at date *T* sees exactly what it would have seen on *T*. The whole series is in the database, so nothing stops a careless query handing the engine tomorrow's bar and producing a beautifully prescient alert that could never have fired.

`computeFeatures` can only read the array it is given, and proxy series are truncated on date inside it. `src/engine/__tests__/pointInTime.test.ts` asserts output at *T* is identical with and without future bars — including when a large move is deliberately planted after the cut — plus a guard that the output *does* change when the as-of date genuinely advances, so the other assertions cannot pass vacuously.

---

## Authentication

Thin by design — email and password, no OAuth, no reset flow, no verification. It exists because the assignment requires state to persist across sessions and devices, which needs an identity. But thin is not the same as sloppy:

| | |
|---|---|
| **Tokens are never stored** | 256-bit CSPRNG value in the cookie; only its SHA-256 in the database. A stolen backup yields no usable session. The row id *used to be* the token. |
| **Rate limited and locked out** | Failures counted independently by email **and** by IP, so rotating IPs cannot dodge the account counter. Backoff at 5, lock at 10, 15-minute rolling window. A success clears that account's failures — but not the origin's, or an attacker on shared NAT could reset their own throttle. |
| **Two clocks** | Absolute 30-day cap *and* a 7-day idle timeout. The cap alone leaves an abandoned session on a shared machine valid for a month. |
| **Password floor** | bcrypt cost 12, 12-character minimum, and a dictionary check — because `password1234` is twelve characters. |
| **Cross-origin writes refused** | `SameSite=Lax` already blocks them; the explicit `Origin`/`Host` check states the guarantee in code rather than inheriting it from a cookie attribute someone might later change. |
| **Sign out everywhere** | The one control that matters after a password is exposed. |

There is **no `SESSION_SECRET`**, and its absence is deliberate: a 256-bit random token that is hashed at rest has nothing to sign. It was previously declared in `.env` and read by no code, which is worse than not having it.

Run `npx tsx scripts/verify-auth.ts` — 12 checks against real Postgres, including that the bearer token appears nowhere in the sessions table.

---

## Testing

225 unit tests, 12 browser journeys, and 69 checks against real Postgres and Redis across four verification suites — requirements, auth, ingestion and cache.

Every detector has a **firing fixture and a must-not-fire fixture** — a detector that only ever fires is indistinguishable from a broken one, and on a product whose promise is filtering noise, false positives are the expensive failure.

Market data cannot produce "a 3.2σ gap on otherwise calm tape" on demand, so `src/engine/testing/synthetic.ts` generates seeded series with injectable events. Real history is used for calibration; synthetic series prove the detectors respond to the thing they claim to detect.

Several tests exist specifically to pin down bugs that were written and then caught:

- range extremes included the current bar, making a break arithmetically impossible
- sector divergence fired on 0.16% moves (tight residual distributions inflate z-scores)
- the session-move validator rejected 9,008 valid rows across a gap in the series
- a 2:1 split deliberately passes the validator — documented as a limitation rather than faked

The browser suite is deliberately thin: four journeys covering the three
minimums plus replay. Broad UI coverage of a product whose logic already has 225
unit tests would be slow to run, slower to maintain, and would mostly re-test
React. It did earn its place immediately though — it caught the acknowledge
button hiding a card optimistically without ever re-reading the brief, so the
cursor and the screen disagreed until the next navigation.

---

## Deliberately not built

Named because they were decisions, not oversights.

**Streaming / real-time.** The product is about *returning later*, not watching ticks. SSE would make the demo busier and the thesis weaker.

**LLM anywhere in the conclusion path.** The narrative is a deterministic rule table over computed facts, and every figure is substituted from a number the engine calculated. A fluent paragraph about someone's money that nobody can trace back to a computation is worse than no paragraph.

**Learned ranking.** Personalisation is two explicit user choices — priority and intent. No cold start, no feedback loop to debug, and the user can always see why their own setting changed the number.

**Earnings in calibration.** Finnhub's free tier serves forward-looking earnings only; historical windows return zero rows. The detector is live-only and its contribution to the attention budget is honestly unmeasured.

---

## Retention and operations

Nothing grows without a stated policy:

| | kept |
|---|---|
| Daily bars | project lifetime |
| Intraday bars | 30 days |
| Dead letters | 90 days |
| Login audit | 90 days |
| Sessions | until expiry, swept hourly |
| Raw provider responses | not retained |

Swept by the worker's `maintenance` job, which is the one scheduled task that ignores the market calendar entirely.

**Backup and restore** — Postgres data lives in the `sitrep_pgdata` Docker volume and survives `docker compose down`. To take a snapshot:

```bash
docker exec sitrep-postgres pg_dump -U sitrep sitrep > backup.sql
```

To restore into a fresh volume:

```bash
docker exec -i sitrep-postgres psql -U sitrep sitrep < backup.sql
```

Not automated. This is a local project, and pretending otherwise would be theatre — but knowing where the state lives and how to get it back is not optional.

---

## Known limitations

- **Backfilling is rate-limited.** Tiingo's free tier allows 50 requests/hour, so a cold backfill of 26 symbols needs two passes an hour apart. `npm run backfill -- --reuse-primary --reuse-secondary` replays whatever is already captured and only fetches what is missing, so re-running costs nothing. During the first pass five symbols were single-source and correctly displayed a `SINGLE SOURCE` badge — degrading visibly rather than silently is the intended behaviour, and the committed fixtures now have full two-source coverage.
- **Daily is the analytical unit.** 15-minute bars exist, but only to time a recent move within its session; no detector reads them, and with 30-day retention (and ~9 months of free-tier history) **historical replay stays daily by design**. Reconstructing March 2020 intraday is not possible here, and is not pretended to be.
- **News is live-only.** The free tier returns roughly the most recent 250 articles before a given date — about two days for a liquid name — and nothing at all for January 2025. News therefore never appears in replay. It also comes from very few outlets: 249 articles for one ticker over two days came from **five** sources, which is why coverage is ranked by distinct outlets and never by article count.
- **Historical context is curated, not sourced live.** A hand-assembled table, every row carrying a source. It is deliberately sparse: most dates match nothing, and saying so is the point.
- **Split adjustment is trusted to the provider.** The validator is a gross-corruption backstop, not a corporate-actions engine.
- **Universe is fixed at 26 symbols.** Adding arbitrary tickers means backfilling them first.

---

## Where the interesting problems were

1. **Two providers, two adjustment bases** — 68,733 phantom conflicts until the units were reconciled.
2. **Calibrating an attention budget** rather than an accuracy score, and discovering the first metric measured the wrong unit entirely.
3. **Making corroboration count** without punishing a lone extreme signal — the coverage exponent.
4. **Knowing when not to detect a theme**, which needed a veto rather than a weight.
5. **Recency decay from a cursor rather than a clock**, which is the difference between a returning user's brief being useful and being empty.
