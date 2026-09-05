# What every page does

Written for someone who has never worked in finance or software. No jargon that
isn't explained the first time it appears.

---

## First, the idea

Imagine you follow seventeen companies. You check on them, then life happens and
you don't look again for two months.

Come back, and a normal app hands you seventeen prices. Which of those changed
in a way that *matters*? Which is just normal wobble? You have no idea, so you
either read all seventeen or you read none.

This product answers that specific question: **what changed since the last time
*you* personally looked, and which of it deserves your attention.**

Three ideas run through every page:

**It remembers when you last looked.** Not "since yesterday" — since *you*.
Reading the page never changes that mark. Only clicking "Mark seen" does. So
glancing at your phone can't wipe the summary waiting on your laptop.

**"Unusual" is measured per company.** A 3% move is enormous for a steady
company and an ordinary Tuesday for a jumpy one. Everything is judged against
that company's own normal behaviour, never a fixed number.

**Nothing is invented.** Every sentence traces to a calculation. When the system
doesn't know something, it says so rather than guessing.

---

## The brief — the main page

The page you land on. Read top to bottom.

### The greeting and the window

> **HERE'S WHAT CHANGED SINCE YOU LAST CHECKED — 75 DAYS AGO**
> You last signed in on 2026-09-05 at 06:19 UTC.

Two different facts. The first is how far back the summary reaches. The second
is when you were actually last here — recorded at sign-in, so it can't drift.

### The one-line summary

> *In 53 trading sessions: 5 names moved more than 20% and 4 went materially
> further than they finished.*

The shape of your absence in a sentence, before you read a single card.

Every part of it is a **count of something already worked out** — never a
description. You will never see "a volatile quarter" or "a rough month", because
the system has no way to decide what counts as rough. It counts, and stops.

"Went materially further than they finished" means: the price travelled
somewhere the start and end don't show. A company that ended up 5% might have
been up 25% and given it back. Same two numbers, completely different two
months.

### The cards

One card per company that needs you. **Usually three to five, never seventeen** —
that restraint is the entire product. A summary that shows everything has no
opinion, and you may as well read the prices yourself.

Reading one card:

| what you see | what it means |
|---|---|
| **NVDA** | the company's short market name |
| **CRITICAL** | how much this matters, worst of four levels |
| **HOLDING · UP** | you told the app you own this, and it's up |
| **HIGH PRIORITY** | you asked for this one to be weighted more heavily |
| **93 ATTENTION** | a 0–100 score. Higher means read this first |
| the sentence in bold | what actually happened, in words |
| **SINCE YOU LOOKED +9.5%** | the change over *your* window, not today |
| **$228.45** | the most recent price |
| the little squiggle | the last 20 trading days at a glance |

Two extra lines appear only when they have something to say:

> **You hold this. It is worth 9.5% more than when you last looked.**

The same move means different things depending on your situation. A fall is bad
news on something you own and *good* news on something you were waiting to buy —
so the app says which, in plain words, coloured accordingly.

> **FELL TO $190.01 on 2026-07-29 — 8.9% below where you last saw it, then
> recovered.**

Where the price went in between. It only appears when the journey wasn't obvious
from the start and end points.

> **REPORTED THAT DAY · did not affect the score**
> *Palantir just won the Army and lost Michael Burry*

News headlines from around that time, so you don't have to go and look them up.

The phrase **"did not affect the score"** is doing real work. The app worked out
that this company mattered by looking only at prices and trading volumes. The
headlines are shown afterwards, as context. They didn't influence the ranking by
a single point — and saying so out loud is more honest than letting you assume.

### "Why am I seeing this?"

Click it on any card. This is the part most products don't have.

```
RANKED 93 BECAUSE
✓ You marked this name High priority                    ×1.30
✓ Outperforming its sector by +7.6% (3.4σ)               +29
✓ +8.7% over session (3.1σ)                              +23
✓ Volume 2.7× the 20-day median                          +22
✓ The move is specific to this company, not the market  ×1.10

WHY NOT HIGHER
✕ Only 3 of 5 signal families fired                     ×0.88
```

The actual arithmetic. Points added, multipliers applied, and the result is the
number on the card.

**"Why not higher" is the important half.** Any system can list the reasons it
liked something. Showing what it *held back* — and by how much — is far harder to
fake, and it's what makes a score arguable rather than something you either
accept or ignore.

The "σ" symbol (sigma) is a size measure: **how big this move is compared with
that company's own typical day.** 3.4σ means "roughly three and a half times its
usual daily swing" — unusual for *this* company, whatever unusual means elsewhere.

Under it you'll also see how often that kind of reason has been followed by a
real move in the past, with the sample size. More on that on the track record
page.

### "While you were away"

A dated list of what happened, in order. The cards answer *what matters now*; a
list of what matters now cannot tell you *when* things happened, because it only
sees the present.

### "Came and went"

Things that flared up **and settled** while you were gone.

These deliberately can't appear in the ranked cards — they're no longer true, so
ranking drops them. But they're the clearest possible answer to "what did I
miss", so they get their own section. Without it the app would silently omit the
very thing you asked about.

### The story

> *11 names in your watchlist need attention, but they do not share a common
> driver. These look like independent, company-specific moves.*

A plain-language read on whether your companies moved for the *same* reason or
for their own separate reasons — which is genuinely useful, because "everything
fell" and "these three fell" mean different things.

Written by a fixed set of rules, not generated. Underneath it says which rule
fired (`rule: scattered`), so you can see it was chosen rather than composed.

### Your attention today

A bar chart of how your seventeen companies were sorted:

```
Critical   3     Background 3
Important  3     Quiet      2
Watch      5     Snoozed    1
```

**This bar makes the argument.** The long "Quiet" bar is not empty space — it's
everything the app read and decided not to bother you with. Six categories, each
meaning something different, none folded into another:

- **Critical / Important / Watch** — worth your time, in descending order
- **Background** — noticed, not worth interrupting you
- **Quiet** — the app looked and found nothing unusual
- **Snoozed** — *you* silenced it; still pending, not resolved

That last distinction matters: "nothing happened" and "you told me to be quiet"
are different facts, and merging them would let the app claim the market was
calm when you had simply muted it.

### The buttons

- **Mark seen** — "I've read this." Moves your bookmark forward. It won't come
  back.
- **Snooze 24h** — "Not now." **Doesn't** move your bookmark. It returns tomorrow
  with its original date, and the footer counts it so it's never silently lost.
- **Mark all seen** — clears the lot at once.

---

## Everything — the unfiltered view

The same companies, the same scores, **with the filter switched off**.

Your brief showed five. This shows all eleven that produced anything, ranked, in
a plain table. Rows past your limit are **dimmed rather than removed**, so you
can see exactly where the cut fell.

This exists because a filter you can't see past is one you have to trust blindly.
Nothing here is extra analysis — it's the same numbers, shown without the cut.

---

## Positions — what it means for you

The same moves, grouped by **what you said you were doing with each company**.

The brief ranks by how unusual something is. That's the right question for
attention and the wrong one for meaning:

| you said | a fall means |
|---|---|
| **Holding** — you own it | it's worth less. Bad news. |
| **Considering** — thinking of buying | it's cheaper. **Good** news. |
| **Hedge** — insurance against something else | it cost you, which is what insurance does |
| **Thematic** — watching an idea | neither; you have no money in it |

Same number, opposite meaning, and it's shown in the colour that matches.

**Nothing here knows what you own.** No quantities, no purchase price, no profit
or loss — none is asked for and none is stored. "Holding" is a label *you* chose,
and every sentence is written to stay true without knowing how much.

---

## Watchlist — your settings

Add or remove companies, and set two things per company:

**Priority** (High / Normal / Low) — multiplies that company's score by 1.3, 1.0
or 0.7. If you care more about one name, say so and the ranking obeys.

**Intent** (Holding / Considering / Hedge / Thematic) — what you're doing with
it, which drives the Positions page.

At the bottom:

- **Show at most N names per brief** — 3 to 10. Anything beyond is *counted*, not
  hidden.
- **See a longer window** — move your bookmark back a week, a month, 75 days or
  six months. For when you were away longer than the app knows, or when you want
  the quarter rather than the week. **Backwards only** — pushing it forward would
  mark things as read that you never saw.
- **Sign out everywhere** — kills every session on every device. The control that
  matters if your password is ever exposed.

---

## Track record — does this thing actually work?

The most unusual page here.

```
detector             fired  followed through   baseline   vs baseline
vol_regime_shift       374   7.2%  n=83         15.2%      0.48×  WORSE THAN CHANCE
sector_divergence      989  17.1%  n=709        15.2%      1.13×
quiet_regime           761  23.3%  n=348        15.2%      1.53×
correlation_break      250  25.6%  n=43         15.1%      1.70×
```

The app has eight different ways of noticing something. This page grades each
one against what actually happened next.

- **followed through** — how often that kind of alert was followed by a real move
  within three days
- **baseline** — the same test applied to *every* day, alert or not. Without it a
  percentage means nothing: something that shouts constantly will look accurate
  by accident
- **vs baseline** — the only number that matters. 1.53× means "half again better
  than looking every day". **0.48× means worse than not bothering.**

Three deliberate choices:

- **sorted worst-first** — a scorecard that leads with its best number is an
  advert
- **the sample size (n=) is always shown** — 100% out of three is not a track
  record
- **the failing one stays on the page.** `vol_regime_shift` does *worse than
  chance* and is published anyway. That it's still there is the strongest
  evidence the rest of the numbers aren't being massaged

---

## Replay — watch it work on the past

Pick a real historical period and step through it one day at a time.

At each step the app sees **only what it would have seen on that date** — nothing
after, even though the rest of the history is sitting in the database. That
constraint is what makes it a demonstration rather than a re-enactment.

Two prepared examples, and they're a **pair** for a reason:

**Semiconductor selloff (Jan 2025)** — press "skip to next event" twice. Several
chip companies fall together, and the app groups them and says the weakness is
*specific to that industry* rather than the whole market.

**COVID crash (Mar 2020)** — step through all 27 days. **No group is ever
reported.** Everything fell, so "chip companies are weak" would be true and
meaningless — the app can tell the difference and stays quiet.

One example alone would look cherry-picked. The pair shows it distinguishing a
real pattern from a coincidence, which is the whole argument.

You can also enter **any two dates** and replay that window. The prepared ones
are shortcuts, not the only supported periods — they run through exactly the
same machinery.

**Historical context** appears under the story when the app knows what was going
on in the world:

> *This coincided with the escalation of the COVID-19 pandemic.*

Note the wording. Always **"coincided with"**, never "caused". The app has no way
to establish cause and doesn't pretend to. When it knows nothing it says so
plainly rather than reaching for the nearest headline.

---

## Pipeline — the plumbing

Where you'd look if something seemed wrong. Not part of daily use.

- **Data quality** — how often the two independent price sources disagreed
  (8 times in 33,616 daily prices). Every price is checked against a second
  provider; disagreements are recorded rather than quietly resolved
- **Queues** — background work waiting, running, done, failed
- **Cache** — how often the fast path is hit, and whether it's currently switched
  off after failures
- **Sources** — when each provider last answered

---

## Two things worth understanding

**Why does the summary sometimes say nothing happened?**

That's a real answer, not an empty screen. If seventeen companies all moved
within their normal range, saying so is more useful than manufacturing something
to show. Most days should be quiet.

**Why doesn't it change every time I log in?**

Two separate clocks. **Prices** update after each market close. **Your bookmark**
moves only when you click "Mark seen". Log in twice in one evening and it's
identical; log in after the next trading day and there's new data. That's the
design — the bookmark is yours, and the app won't move it just because you
glanced at the page.
