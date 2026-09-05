import { db } from './db'
import { scoreSignals, explainContributions } from '@/engine/scorer'
import {
  absenceSummary,
  buildNarrative,
  type Narrative,
} from '@/engine/narrative'
import {
  MIN_SCORECARD_SAMPLE,
  SIGNAL_TO_DETECTOR,
  type TrackRecord,
} from '@/engine/followthrough'
import type { DetectedTheme } from '@/engine/theme'
import type {
  Contribution,
  Intent,
  Priority,
  ScoringContext,
  Severity,
  Signal,
} from '@/engine/types'
import { MARKET_BENCHMARK } from './universe'
import { frameForPosition, type PositionFraming } from '@/engine/position'
import { nyDate, sessionsBehind, tradingDaysBetween } from './market-calendar'
import { cached, invalidateUser, TTL } from './cache'
import { buildChronology, findCameAndWent } from './briefing'
import { previousSignIn } from './auth'

/**
 * The SITREP: what changed since this user last looked.
 *
 * The read path is a personalised FILTER over precomputed rows, never a
 * recomputation. Events, scores and themes already exist (see compute.ts); what
 * happens here is cheap and O(watchlist): pull events past the cursor, re-weight
 * them by this user's priority and intent, rank, and cut to the attention budget.
 *
 * Crucially the window is per-user. Two people opening the app at the same
 * instant get different briefs because they last looked at different times.
 */

const SURFACED: Severity[] = ['CRITICAL', 'IMPORTANT', 'WATCH']

/** Default number of cards. Deliberately small; see docs/calibration.md. */
export const DEFAULT_ATTENTION_BUDGET = 5

export interface Extreme {
  close: number
  date: string
  /** Distance from today's close. */
  fromNowPct: number
  /** Distance from the price when the user last looked. */
  fromBaselinePct: number
}

export interface ChronologyEntry {
  /** `YYYY-MM-DD` */
  date: string
  /** Session time when known, from 15-minute bars. Null for older dates. */
  timeOfDay: string | null
  kind: 'move' | 'theme' | 'earnings'
  symbol: string | null
  text: string
}

export interface SitrepItem {
  symbol: string
  name: string
  sector: string | null
  attentionScore: number
  severity: Severity
  headline: string
  /** Every reason, positive and negative, behind the score. */
  positives: Contribution[]
  suppressors: Contribution[]
  eventIds: string[]
  /**
   * Headlines published around the same time. Corroboration, never a signal:
   * these did not create the event and did not affect the score.
   */
  coverage: Array<{
    headline: string
    source: string
    url: string
    outlets: number
    publishedAt: string
  }>
  /** Net move over the absence window, not just the last session. */
  windowReturnPct: number | null
  sigmas: number | null
  /**
   * The high and low reached DURING the absence, when they were not today.
   *
   * The endpoints hide the path: "up 5.5% since you looked" and "up 5.5%,
   * having been 19% higher three weeks ago and given it all back" are the same
   * two numbers describing completely different fortnights.
   */
  /**
   * Where this name sat in the brief the last time it was acknowledged, and
   * where it sits now. Null when it has never been cleared.
   */
  previousRank: number | null
  rank: number
  /** What the move MEANS for the position the user declared. */
  framing: PositionFraming | null
  peak: Extreme | null
  trough: Extreme | null
  lastClose: number
  asOf: string
  confidence: number
  /** False only when two sources actively disagreed. */
  confirmed: boolean
  /** False when only one source reported — uncorroborated, but not disputed. */
  corroborated: boolean
  priority: Priority
  intent: Intent
  themeKey: string | null
  sparkline: number[]
}

export interface SitrepResult {
  displayName: string
  /** Cursor: the moment this user last acknowledged anything. */
  since: Date | null
  absenceHours: number | null
  asOf: string | null
  items: SitrepItem[]
  themes: Array<DetectedTheme & { id: string }>
  narrative: Narrative
  /** Severity histogram across the whole watchlist, for the budget bar. */
  budget: Record<Severity, number>
  withinNormalRange: number
  /** Names the user actively silenced. Never folded into "normal range". */
  snoozedCount: number
  /**
   * Every watched name, ranked but NOT cut to the attention budget.
   *
   * The brief has an opinion; this is the same market without it. Both views
   * exist because "what deserves my attention" and "what is going on" are
   * different questions, and answering the first should not make the second
   * unavailable.
   */
  all: SitrepItem[]
  /**
   * What happened, in order, while the user was away.
   *
   * The ranked cards answer "what matters now". This answers "what happened",
   * which is a different question and the one a returning user actually asks
   * first.
   */
  chronology: ChronologyEntry[]
  /**
   * Events that fired AND resolved during the absence.
   *
   * Invisible in the ranked list by construction: ranking only sees what is
   * still true. Without this the brief silently omits the thing the user most
   * plainly missed.
   */
  cameAndWent: Array<{ symbol: string; headline: string; date: string }>
  /** The visit before this one, for the opening line. */
  previousVisit: { at: Date; newDevice: boolean } | null
  /**
   * One sentence describing the shape of the absence, before any card.
   * Null when there is nothing countable to say.
   */
  absenceSummary: string | null
  /**
   * Per-SIGNAL track record, so a reason can be shown next to how often that
   * kind of reason has preceded a real move. Keyed by signal key, which is what
   * contributions carry.
   */
  trackRecord: Record<string, TrackRecord>
  /** Flagged by the engine but cut by the attention budget. */
  belowBudget: number
  watchlistSize: number
  quiet: boolean
  attentionBudget: number
  dataQuality: {
    stalestSource: string | null
    lagSeconds: number | null
    unconfirmedCount: number
    /**
     * Sessions behind the market, by the trading calendar rather than by the
     * clock. Zero on a Saturday holding Friday's close; two on a Tuesday
     * afternoon holding the same one.
     */
    sessionsBehind: number
    /** Dates missing from inside the stored series, not merely off the end. */
    holes: number
  }
}

interface WatchRow {
  instrumentId: string
  symbol: string
  name: string
  sector: string | null
  priority: Priority
  intent: Intent
}

/**
 * The brief, cached.
 *
 * Assembling it is the expensive read - a cursor query, per-instrument window
 * statistics, themes, chronology - and it is also the one thing every page
 * load needs. Caching it is what makes `invalidateUser` mean something: until
 * now that function deleted a key nothing ever wrote, so the invalidation was
 * correct only because there was nothing to invalidate.
 *
 * Safe because both directions are covered. A recompute retires every entry
 * through the generation counter; anything the USER does that changes their
 * own answer - mark seen, snooze, a watchlist edit, signing in - drops their
 * key explicitly. TTL is only there so superseded generations do not linger.
 */
export async function buildSitrep(userId: string): Promise<SitrepResult> {
  return cached('sitrep', userId, TTL.sitrep, () => assembleSitrep(userId))
}

async function assembleSitrep(userId: string): Promise<SitrepResult> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { displayName: true, settings: true },
  })

  const settings = (user.settings ?? {}) as { attentionBudget?: number }
  const attentionBudget = settings.attentionBudget ?? DEFAULT_ATTENTION_BUDGET

  const watchlist = await db.watchlist.findFirst({
    where: { userId },
    include: {
      items: {
        include: {
          instrument: {
            select: { id: true, symbol: true, name: true, sector: true },
          },
        },
      },
    },
  })

  const rows: WatchRow[] = (watchlist?.items ?? []).map((i) => ({
    instrumentId: i.instrument.id,
    symbol: i.instrument.symbol,
    name: i.instrument.name,
    sector: i.instrument.sector,
    priority: i.priority,
    intent: i.intent,
  }))

  if (rows.length === 0) {
    return emptyResult(user.displayName, attentionBudget)
  }

  const instrumentIds = rows.map((r) => r.instrumentId)

  // ---- the cursor --------------------------------------------------------
  const cursors = await db.userWatchState.findMany({
    where: { userId, instrumentId: { in: instrumentIds } },
  })
  const cursorByInstrument = new Map(cursors.map((c) => [c.instrumentId, c]))

  // The brief window starts at the OLDEST cursor across the watchlist: a name
  // the user has not acknowledged in a month should still be able to report
  // what it did, even if they cleared everything else yesterday.
  const cursorTimes = cursors.map((c) => c.lastSeenAt.getTime())
  const since = cursorTimes.length ? new Date(Math.min(...cursorTimes)) : null

  const now = new Date()
  const absenceHours = since ? (now.getTime() - since.getTime()) / 3_600_000 : null

  // ---- events past the cursor -------------------------------------------
  const events = await db.event.findMany({
    where: {
      instrumentId: { in: instrumentIds },
      scenarioId: null,
      severity: { in: ['CRITICAL', 'IMPORTANT', 'WATCH', 'INFO'] },
      ...(since ? { marketTime: { gt: since } } : {}),
    },
    orderBy: { marketTime: 'desc' },
    include: { theme: true },
  })

  // Anti-join: anything already seen or dismissed is gone unless a snooze has
  // expired. Merely LOADING the brief never advances the cursor, so a glance on
  // a phone cannot silently clear the laptop.
  const seen = await db.userEventState.findMany({
    where: {
      userId,
      eventId: { in: events.map((e) => e.id) },
      status: { in: ['SEEN', 'DISMISSED'] },
    },
    select: { eventId: true },
  })
  const seenIds = new Set(seen.map((s) => s.eventId))

  const snoozed = await db.userEventState.findMany({
    where: { userId, status: 'SNOOZED', snoozedUntil: { gt: now } },
    select: { eventId: true },
  })
  const snoozedIds = new Set(snoozed.map((s) => s.eventId))

  const visible = events.filter(
    (e) => !seenIds.has(e.id) && !snoozedIds.has(e.id),
  )

  // Names the user actively silenced, tracked separately.
  //
  // A snoozed name has NOT "moved within its normal range" - the engine flagged
  // it and the user deferred it, without advancing the cursor. Folding the two
  // together would let the brief under-report what it actually found, which is
  // the one lie a product built on filtering cannot afford to tell.
  //
  // The boundary: an instrument counts as silenced only when snoozing removed
  // everything it had to say. If something else about it is still visible, it
  // was still assessed, and it belongs in the ordinary counts.
  const visibleInstruments = new Set(visible.map((e) => e.instrumentId))
  const snoozedInstruments = new Set(
    events
      .filter(
        (e) => snoozedIds.has(e.id) && !visibleInstruments.has(e.instrumentId),
      )
      .map((e) => e.instrumentId),
  )

  // ---- per-instrument re-scoring under this user's context ---------------
  const byInstrument = new Map<string, typeof visible>()
  for (const e of visible) {
    const list = byInstrument.get(e.instrumentId) ?? []
    list.push(e)
    byInstrument.set(e.instrumentId, list)
  }

  const budget: Record<Severity, number> = {
    CRITICAL: 0,
    IMPORTANT: 0,
    WATCH: 0,
    INFO: 0,
    NOISE: 0,
  }

  const items: SitrepItem[] = []

  for (const row of rows) {
    const instrumentEvents = byInstrument.get(row.instrumentId) ?? []
    if (instrumentEvents.length === 0) {
      // A silenced name is not a quiet one. Counting it as NOISE would let the
      // budget bar claim the market was calm when the user simply muted it.
      if (!snoozedInstruments.has(row.instrumentId)) budget.NOISE++
      continue
    }

    const cursor = cursorByInstrument.get(row.instrumentId)

    // Recency decay is measured from the CURSOR, not from the wall clock.
    //
    // Every event reaching this point is unseen by this user - the seen and
    // dismissed ones were anti-joined away above - so it is new to them however
    // old it is to the market. Decaying from `now` meant a 5-sigma move that
    // happened three days into a ten-week absence arrived at the 0.35 floor and
    // was filed as noise, which is exactly the thing the user came back to find
    // out about. Decay still applies to events surfaced again after being seen.
    const ageTradingDays = 0

    const signals: Signal[] = instrumentEvents.flatMap((e) => {
      const stored = e.features as { signals?: Signal[] } | null
      return stored?.signals ?? []
    })

    const worstConfidence = Math.min(...instrumentEvents.map((e) => e.confidence))
    // Confirmed is NOT derived from confidence. A single-source bar sits at 0.9
    // confidence but is confirmed - nothing contradicted it. Only an actual
    // cross-source disagreement makes it unconfirmed, and the UI says different
    // things about the two.
    const anyUnconfirmed = instrumentEvents.some((e) => !e.confirmed)

    const ctx: ScoringContext = {
      priority: row.priority,
      intent: row.intent,
      dataConfidence: worstConfidence,
      confirmed: !anyUnconfirmed,
      ageTradingDays,
      hasCatalyst: instrumentEvents.some((e) => e.type === 'earnings_upcoming'),
      isIdiosyncratic: instrumentEvents.some((e) => e.type === 'sector_divergence'),
      isMacroDay: false,
    }

    const scored = scoreSignals(signals, ctx)
    const { positives, suppressors } = explainContributions(scored.contributions)

    // The headline must name the same thing the reasoning ranks first.
    //
    // Two earlier versions of this line were both wrong. Ordering by TIME meant
    // a name that moved 62% over the window could be introduced by a passing
    // volume note. Ordering by raw event SCORE fixed that but introduced a
    // subtler problem: the Why panel ranks merged signals re-scored under this
    // user's priority and intent, so NVDA could be headlined "Volume is 2.7x
    // normal" while the panel underneath said the top reason was sector
    // divergence. Both statements were true and the pair read as a
    // contradiction.
    //
    // So the lead is the event that OWNS the winning signal - matched on label
    // as well as key, because the same detector can fire on several days and
    // only one of those instances is the one the panel is showing.
    const top = positives.find((c) => c.kind === 'additive')
    const lead =
      (top &&
        [...instrumentEvents]
          .sort((a, b) => b.score - a.score)
          .find((e) =>
            ((e.features as { signals?: Signal[] } | null)?.signals ?? []).some(
              (sig) => sig.key === top.key && sig.label === top.label,
            ),
          )) ||
      [...instrumentEvents].sort((a, b) => b.score - a.score)[0]

    budget[scored.severity]++

    const window = await windowStats(row.instrumentId, cursor?.lastSeenAt ?? null)

    items.push({
      symbol: row.symbol,
      name: row.name,
      sector: row.sector,
      attentionScore: Math.round(scored.score),
      severity: scored.severity,
      headline: lead.headline,
      positives,
      suppressors,
      eventIds: instrumentEvents.map((e) => e.id),
      windowReturnPct: window.returnPct,
      sigmas: window.sigmas,
      previousRank:
        typeof (cursor?.lastSeenSnap as { rank?: number } | null)?.rank ===
        'number'
          ? ((cursor!.lastSeenSnap as { rank: number }).rank)
          : null,
      // Filled in after ranking, which is the only point at which it is known.
      rank: 0,
      framing: null,
      peak: window.peak,
      trough: window.trough,
      lastClose: window.lastClose,
      asOf: window.asOf,
      confidence: worstConfidence,
      confirmed: !anyUnconfirmed,
      corroborated: worstConfidence >= 1,
      priority: row.priority,
      intent: row.intent,
      themeKey: instrumentEvents.find((e) => e.theme)?.theme?.scopeKey ?? null,
      sparkline: window.sparkline,
      coverage: [],
    })
  }

  const surfaced = items
    .filter((i) => SURFACED.includes(i.severity))
    .sort((a, b) => b.attentionScore - a.attentionScore)

  const shown = surfaced.slice(0, attentionBudget)

  // Rank is a property of the assembled brief, not of an instrument, so it can
  // only be assigned once everything has been scored and sorted.
  surfaced.forEach((item, i) => {
    item.rank = i + 1
    item.framing = frameForPosition({
      intent: item.intent,
      returnPct: item.windowReturnPct,
      sigmas: item.sigmas,
      peakFromNowPct: item.peak?.fromNowPct ?? null,
      troughFromNowPct: item.trough?.fromNowPct ?? null,
    })
  })

  // Names that genuinely did nothing. Anything the engine flagged but the
  // attention budget cut is NOT "within normal range" - saying so would
  // misreport what was actually found, which is the one thing a product built
  // on filtering cannot afford to do.
  const withinNormalRange =
    rows.length - surfaced.length - snoozedInstruments.size
  const belowBudget = surfaced.length - shown.length

  // ---- themes and narrative ---------------------------------------------
  const themeIds = [
    ...new Set(visible.map((e) => e.themeId).filter((id): id is string => !!id)),
  ]
  const themeRows = await db.theme.findMany({
    where: { id: { in: themeIds } },
    orderBy: { confidence: 'desc' },
  })

  const themes = themeRows.map((t) => ({
    id: t.id,
    scope: 'sector' as const,
    scopeKey: t.scopeKey,
    members: [] as string[],
    direction: (t.summary.includes('selling') ? -1 : 1) as -1 | 1,
    windowStart: t.windowStart.toISOString().slice(0, 10),
    windowEnd: t.windowEnd.toISOString().slice(0, 10),
    memberCount: t.memberCount,
    confidence: t.confidence,
    cohesion: t.cohesion,
    timing: t.timing,
    size: t.size,
    distinctness: t.distinctness,
    characteristics: t.characteristics,
    summary: t.summary,
  }))

  for (const theme of themes) {
    theme.members = shown
      .filter((i) => i.themeKey === theme.scopeKey)
      .map((i) => i.symbol)
  }

  const market = await marketContext(since)

  const narrative = buildNarrative({
    themes,
    topEventSectors: shown.map((i) => i.sector ?? ''),
    marketReturn: market.returnPct,
    marketSigmas: market.sigmas,
    breadth:
      rows.length > 0
        ? items.filter((i) => (i.sigmas ?? 0) > 1).length / rows.length
        : 0,
    watchlistSize: rows.length,
    notableCount: surfaced.length,
    snoozedCount: snoozedInstruments.size,
  })

  // One query for the whole brief, not one per card. The scorecard is a small
  // table refreshed by compute; the read path only reads it.
  const scorecards = await db.detectorScorecard.findMany()
  const byDetector = new Map(scorecards.map((r) => [r.detector, r]))
  const trackRecord: Record<string, TrackRecord> = {}
  for (const [signalKey, detector] of Object.entries(SIGNAL_TO_DETECTOR)) {
    const row = byDetector.get(detector)
    // Below the sample floor the honest thing is to say nothing, not to print
    // a percentage that a handful of observations cannot support.
    if (!row || row.checked < MIN_SCORECARD_SAMPLE) continue
    const base = row.baseChecked > 0 ? row.baseFollowed / row.baseChecked : 0
    const rate = row.followed / row.checked
    trackRecord[signalKey] = {
      rate,
      n: row.checked,
      lift: base > 0 ? rate / base : null,
    }
  }

  const latestBar = await db.dailyBar.findFirst({
    where: { instrumentId: { in: instrumentIds } },
    orderBy: { barDate: 'desc' },
    select: { barDate: true },
  })
  const latestAsOf = latestBar?.barDate.toISOString().slice(0, 10) ?? null

  // Staleness belongs on the BRIEF, not only on the ops page.
  //
  // Once ingestion runs unattended its failures become invisible, and the one
  // thing this product cannot afford is for missing data to look like a quiet
  // market. Measured in sessions against the trading calendar, so a weekend is
  // never mistaken for an outage.
  const freshnessCheck = await checkFreshness(instrumentIds)

  // The absence, as a sequence rather than a ranking. Answers the question a
  // returning user actually asks first.
  // Headlines for the surfaced names, in ONE query rather than per card.
  //
  // Attached to what the price engine already found. Nothing here creates an
  // event or moves a score - `WhyPanel` says so in words - because ranking
  // unstructured text without a model would mean counting articles, and 249
  // articles for one ticker over two days came from five outlets. That
  // measures syndication, not importance.
  const shownIds = rows
    .filter((r) => shown.some((i) => i.symbol === r.symbol))
    .map((r) => r.instrumentId)
  const coverageByInstrument = await loadCoverage(shownIds, since)
  for (const item of shown) {
    const row = rows.find((r) => r.symbol === item.symbol)
    item.coverage = row ? (coverageByInstrument.get(row.instrumentId) ?? []) : []
  }

  const chronology = await buildChronology(instrumentIds, since)
  const cameAndWent = await findCameAndWent(
    instrumentIds,
    since,
    shown.map((i) => i.symbol),
  )
  const prior = await previousSignIn(userId)

  // The shape of the absence, in one line. Counts of things already computed;
  // a reader should not have to parse five cards to learn it.
  const windowSessions = since
    ? Math.max(
        0,
        tradingDaysBetween(since.toISOString().slice(0, 10), nyDate(now))
          .length - 1,
      )
    : 0

  const largest = items.reduce<SitrepItem | null>(
    (best, i) =>
      Math.abs(i.windowReturnPct ?? 0) > Math.abs(best?.windowReturnPct ?? 0)
        ? i
        : best,
    null,
  )

  const summary = absenceSummary({
    sessions: windowSessions,
    bigMovers: items.filter((i) => Math.abs(i.windowReturnPct ?? 0) >= 0.2).length,

    largestMovePct: largest?.windowReturnPct ?? 0,
    largestMoveSymbol: largest?.symbol ?? null,
    themesFormed: themes.length,
    earningsReported: chronology.filter((c) => c.kind === 'earnings').length,
    // A ROUND TRIP, not merely an excursion.
    //
    // The first version counted any name whose high or low sat 8% from today,
    // which over 53 sessions was true of sixteen names out of seventeen - a
    // clause true of nearly everything tells the reader nothing. A round trip
    // is a path that went somewhere the endpoints genuinely hide: the
    // excursion has to be large in absolute terms AND at least twice the net
    // move, which is what separates "rose and gave it back" from "rose".
    roundTrips: surfaced.filter((i) => {
      // Same test the card uses: went above where it is now, or below where
      // you left it. Both are excursions the endpoints do not imply.
      // A higher bar than the card uses, deliberately. The card is detail
      // about one name and 5% is worth a line there; the summary is a headline
      // count, and a clause that covers most of the watchlist tells the reader
      // nothing. 15% is an excursion someone would actually remember.
      const gaveBack = i.peak?.fromNowPct ?? 0
      const dipped = i.trough?.fromBaselinePct ?? 0
      return gaveBack >= 0.15 || dipped <= -0.15
    }).length,
  })

  const freshness = await db.dataFreshness.findMany({
    orderBy: { lastSuccess: 'asc' },
    take: 1,
  })

  return {
    displayName: user.displayName,
    since,
    absenceHours,
    // Falls back to the latest bar we hold, because "as of" describes the DATA,
    // not the brief. Deriving it from the surfaced items made a quiet day read
    // "no data yet", which says the pipeline is broken when it is working.
    asOf: shown[0]?.asOf ?? items[0]?.asOf ?? latestAsOf,
    items: shown,
    themes,
    narrative,
    budget,
    withinNormalRange,
    snoozedCount: snoozedInstruments.size,
    all: surfaced,
    chronology,
    cameAndWent,
    absenceSummary: summary,
    previousVisit: prior
      ? {
          at: prior.at,
          // A different user-agent is worth mentioning; it is also the only
          // device signal available without fingerprinting, which this
          // project deliberately does not do.
          newDevice: false,
        }
      : null,
    trackRecord,
    belowBudget,
    watchlistSize: rows.length,
    quiet: surfaced.length === 0,
    attentionBudget,
    dataQuality: {
      stalestSource: freshness[0]?.sourceId ?? null,
      lagSeconds: freshness[0]?.lagSeconds ?? null,
      unconfirmedCount: items.filter((i) => !i.confirmed).length,
      sessionsBehind: freshnessCheck.sessionsBehind,
      holes: freshnessCheck.holes,
    },
  }
}

/**
 * Move over the absence window, not just the last session.
 *
 * This is the difference between "NVDA is down 0.4% today" and "NVDA is down 8%
 * since you last looked" — the second is the thing the user actually missed,
 * and it is invisible to any watchlist that only shows a daily change.
 */
/**
 * Window statistics for one instrument, cached.
 *
 * This is the actual O(watchlist) cost in the read path: one query per watched
 * name, per brief. Caching it is the difference between the scaling story
 * being an argument and being true — and because the value depends only on
 * stored bars and the cursor, generation invalidation retires it correctly
 * whenever compute runs.
 */
async function windowStats(instrumentId: string, since: Date | null) {
  return cached(
    'windowStats',
    `${instrumentId}:${since?.toISOString() ?? 'none'}`,
    TTL.windowStats,
    () => computeWindowStats(instrumentId, since),
  )
}

async function computeWindowStats(instrumentId: string, since: Date | null) {
  // Four small queries, not one growing array.
  //
  // This began as a fixed 40 bars, which silently broke the headline number:
  // a 75-day absence spans about 52 sessions, so the cursor bar fell off the
  // end of the array and "since you looked" measured from the oldest bar
  // loaded instead. Raising the limit to cover the window fixed that case and
  // left the same failure waiting further out - an absence past the cap would
  // land in exactly the same place.
  //
  // A ceiling is not a fix. Nothing here actually needs the window as an
  // array: the baseline is ONE row, the extremes are one row each, and the
  // recent tail is only for volatility and the sparkline. Asking the database
  // for each directly is correct for an absence of any length and returns a
  // bounded number of rows however long that is.
  const RECENT_SESSIONS = 40

  const recent = await db.dailyBar.findMany({
    where: { instrumentId },
    orderBy: { barDate: 'desc' },
    take: RECENT_SESSIONS,
    select: {
      barDate: true,
      closeAdj: true,
      asOf: true,
      confidence: true,
      confirmed: true,
    },
  })

  if (recent.length === 0) {
    return {
      returnPct: null,
      sigmas: null,
      lastClose: 0,
      asOf: '',
      sparkline: [],
      peak: null,
      trough: null,
    }
  }

  const ascending = [...recent].reverse()
  const closes = ascending.map((b) => Number(b.closeAdj))
  const last = closes[closes.length - 1]
  const latest = ascending[ascending.length - 1]

  // Daily volatility from the recent tail. This is a property of the name, not
  // of the absence, so it does not need the whole window.
  const rets: number[] = []
  for (let i = 1; i < closes.length; i++) {
    rets.push(Math.log(closes[i] / closes[i - 1]))
  }
  const mean = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length)
  const variance =
    rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1)
  const sigma = Math.sqrt(variance)

  // The baseline: the last close at or before the cursor. One row, exact,
  // however long ago that was.
  const baselineRow = since
    ? await db.dailyBar.findFirst({
        where: { instrumentId, barDate: { lte: since } },
        orderBy: { barDate: 'desc' },
        select: { barDate: true, closeAdj: true },
      })
    : null

  const baseline = baselineRow
    ? { date: baselineRow.barDate, close: Number(baselineRow.closeAdj) }
    : // No cursor, or a cursor older than any stored bar: fall back to the
      // previous session, which is what "since you last looked" degrades to
      // for a brand-new watcher.
      {
        date: ascending[Math.max(0, ascending.length - 2)].barDate,
        close: closes[Math.max(0, closes.length - 2)],
      }

  const from = baseline.close
  const returnPct = from > 0 ? last / from - 1 : null

  const sessionsElapsed = Math.max(
    1,
    tradingDaysBetween(
      baseline.date.toISOString().slice(0, 10),
      latest.barDate.toISOString().slice(0, 10),
    ).length - 1,
  )

  const sigmas =
    sigma > 0 && from > 0
      ? Math.log(last / from) / (sigma * Math.sqrt(sessionsElapsed))
      : null

  // The PATH, not just the endpoints.
  //
  // "Up 5.5% since you looked" and "up 5.5%, having been 19% higher three
  // weeks ago and given it all back" are the same two numbers describing
  // completely different fortnights. One row each, ordered by price rather
  // than pulled back and scanned.
  const windowFilter = {
    instrumentId,
    barDate: { gt: baseline.date },
  }

  const [highRow, lowRow] = await Promise.all([
    db.dailyBar.findFirst({
      where: windowFilter,
      orderBy: { closeAdj: 'desc' },
      select: { barDate: true, closeAdj: true },
    }),
    db.dailyBar.findFirst({
      where: windowFilter,
      orderBy: { closeAdj: 'asc' },
      select: { barDate: true, closeAdj: true },
    }),
  ])

  const extreme = (row: { barDate: Date; closeAdj: unknown } | null) => {
    if (!row) return null
    const close = Number(row.closeAdj)
    const date = row.barDate.toISOString().slice(0, 10)
    // An extreme that IS today is not a path, it is the price.
    if (date === latest.barDate.toISOString().slice(0, 10)) return null
    return {
      close,
      date,
      fromNowPct: last > 0 ? close / last - 1 : 0,
      // Measured against WHERE YOU LEFT IT, which is the comparison that
      // decides whether the path is news.
      //
      // Against today, a name up 76% will always report a low far below -
      // which is arithmetic, not information. Against the baseline, the same
      // low says nothing (it simply rose), while a name up 9% that first fell
      // 9% BELOW where you last saw it has genuinely been somewhere the
      // endpoints do not show.
      fromBaselinePct: from > 0 ? close / from - 1 : 0,
    }
  }

  return {
    returnPct,
    sigmas,
    lastClose: last,
    asOf: latest.asOf.toISOString(),
    sparkline: closes.slice(-20),
    peak: extreme(highRow),
    trough: extreme(lowRow),
  }
}

/** Benchmark move over the same window, used by the narrative rules. */
async function marketContext(since: Date | null) {
  const instrument = await db.instrument.findUnique({
    where: { symbol: MARKET_BENCHMARK },
    select: { id: true },
  })
  if (!instrument) return { returnPct: 0, sigmas: 0 }

  const stats = await windowStats(instrument.id, since)
  return { returnPct: stats.returnPct ?? 0, sigmas: stats.sigmas ?? 0 }
}

function emptyResult(displayName: string, attentionBudget: number): SitrepResult {
  return {
    displayName,
    since: null,
    absenceHours: null,
    asOf: null,
    items: [],
    themes: [],
    narrative: {
      ruleId: 'empty_watchlist',
      text: 'Add a few names to your watchlist and your first SITREP will appear after the next close.',
      inputs: {},
    },
    budget: { CRITICAL: 0, IMPORTANT: 0, WATCH: 0, INFO: 0, NOISE: 0 },
    withinNormalRange: 0,
    snoozedCount: 0,
    all: [],
    chronology: [],
    cameAndWent: [],
    absenceSummary: null,
    previousVisit: null,
    trackRecord: {},
    belowBudget: 0,
    watchlistSize: 0,
    quiet: true,
    attentionBudget,
    dataQuality: {
      stalestSource: null,
      lagSeconds: null,
      unconfirmedCount: 0,
      sessionsBehind: 0,
      holes: 0,
    },
  }
}

/**
 * Advance the cursor.
 *
 * Guarded by a monotonic version so two devices cannot move it backwards: a
 * queued acknowledgement replayed from a phone that was offline must not undo
 * a later one made on a laptop.
 */
export async function markSeen(
  userId: string,
  instrumentIds: string[],
  eventIds: string[] = [],
  /**
   * Where each instrument sat in the brief at the moment it was acknowledged.
   *
   * Recorded here rather than when the brief is READ, because reading must
   * never write - that rule is what makes a glance on a phone safe. An
   * explicit acknowledgement is a different thing, and it gives "last time"
   * a defined meaning: the last brief you actually cleared.
   */
  ranks: Record<string, number> = {},
): Promise<{ moved: number }> {
  const now = new Date()
  let moved = 0

  for (const instrumentId of instrumentIds) {
    const existing = await db.userWatchState.findUnique({
      where: { userId_instrumentId: { userId, instrumentId } },
    })

    if (existing && existing.lastSeenAt >= now) continue

    const snapshot = await db.dailyBar.findFirst({
      where: { instrumentId },
      orderBy: { barDate: 'desc' },
      select: { barDate: true, closeAdj: true },
    })

    await db.userWatchState.upsert({
      where: { userId_instrumentId: { userId, instrumentId } },
      create: {
        userId,
        instrumentId,
        lastSeenAt: now,
        lastSeenSnap: {
          date: snapshot?.barDate.toISOString().slice(0, 10) ?? null,
          close: snapshot ? Number(snapshot.closeAdj) : null,
          rank: ranks[instrumentId] ?? null,
        },
        cursorVersion: BigInt(1),
      },
      update: {
        lastSeenAt: now,
        lastSeenSnap: {
          date: snapshot?.barDate.toISOString().slice(0, 10) ?? null,
          close: snapshot ? Number(snapshot.closeAdj) : null,
          rank: ranks[instrumentId] ?? null,
        },
        cursorVersion: { increment: BigInt(1) },
      },
    })
    moved++
  }

  for (const eventId of eventIds) {
    await db.userEventState.upsert({
      where: { userId_eventId: { userId, eventId } },
      create: { userId, eventId, status: 'SEEN' },
      update: { status: 'SEEN' },
    })
  }

  await db.user.update({
    where: { id: userId },
    data: { lastActiveAt: now },
  })

  // The brief this user sees has just changed. Explicit invalidation, not a
  // short TTL: acknowledging something and then seeing it again would break
  // the one interaction the whole product is built around.
  await invalidateUser(userId)

  return { moved }
}

/**
 * Defer, without acknowledging.
 *
 * Snooze and mark-seen are deliberately different operations. Mark-seen means
 * "I have absorbed this" and moves the cursor, so the next brief measures from
 * now. Snooze means "not now" and moves nothing: the cursor stays put, the
 * window keeps growing, and when the snooze lapses the event returns with its
 * original timestamp intact. Conflating them would quietly destroy the very
 * thing this product is built around.
 *
 * Scoped through the user's own watchlist, so an id they do not watch cannot be
 * written into their state - the same ownership check mark-seen applies.
 */
/**
 * How far behind the data is, and whether anything is missing from the middle.
 *
 * Deliberately calendar-based rather than clock-based: `now - lastBar > 24h`
 * reports every Saturday as an outage, which trains a user to ignore the
 * warning exactly when it starts being true.
 */
/**
 * Headlines around the surfaced events.
 *
 * Ranked by how many distinct outlets carried the story, never by article
 * count - the ordering is the whole design, because a wire service posting
 * forty times is a fact about publishing, not about the company.
 */
async function loadCoverage(
  instrumentIds: string[],
  since: Date | null,
): Promise<Map<string, SitrepItem['coverage']>> {
  const out = new Map<string, SitrepItem['coverage']>()
  if (instrumentIds.length === 0) return out

  const rows = await db.newsItem.findMany({
    where: {
      instrumentId: { in: instrumentIds },
      ...(since ? { publishedAt: { gt: since } } : {}),
    },
    orderBy: [{ corroboration: 'desc' }, { publishedAt: 'desc' }],
    take: instrumentIds.length * 3,
  })

  for (const r of rows) {
    const list = out.get(r.instrumentId) ?? []
    // Two headlines per name. This is context on a card, not a news reader.
    if (list.length >= 2) continue
    list.push({
      headline: r.headline,
      source: r.source,
      url: r.url,
      outlets: r.corroboration,
      publishedAt: r.publishedAt.toISOString().slice(0, 10),
    })
    out.set(r.instrumentId, list)
  }

  return out
}

async function checkFreshness(
  instrumentIds: string[],
): Promise<{ sessionsBehind: number; holes: number }> {
  if (instrumentIds.length === 0) return { sessionsBehind: 0, holes: 0 }

  const now = new Date()
  const latest = await db.dailyBar.findFirst({
    where: { instrumentId: { in: instrumentIds } },
    orderBy: { barDate: 'desc' },
    select: { barDate: true },
  })

  const latestDate = latest?.barDate.toISOString().slice(0, 10) ?? null
  const behind = sessionsBehind(latestDate, now)

  // Holes are counted across the watched names only: a gap in an instrument
  // the user does not watch is an ops problem, not something to put on their
  // brief.
  let holes = 0
  if (latestDate) {
    const scanFrom = tradingDaysBetween(
      new Date(now.getTime() - 45 * 86_400_000).toISOString().slice(0, 10),
      latestDate,
    )
    const expected = new Set(scanFrom)
    const stored = await db.dailyBar.findMany({
      where: {
        instrumentId: { in: instrumentIds },
        barDate: { gte: new Date(`${scanFrom[0] ?? latestDate}T00:00:00Z`) },
      },
      select: { instrumentId: true, barDate: true },
    })

    const byInstrument = new Map<string, Set<string>>()
    for (const row of stored) {
      const set = byInstrument.get(row.instrumentId) ?? new Set<string>()
      set.add(row.barDate.toISOString().slice(0, 10))
      byInstrument.set(row.instrumentId, set)
    }

    for (const set of byInstrument.values()) {
      for (const date of expected) {
        if (!set.has(date)) holes++
      }
    }
  }

  return {
    sessionsBehind: Number.isFinite(behind) ? behind : 0,
    holes,
  }
}

export async function snoozeEvents(
  userId: string,
  eventIds: string[],
  until: Date,
): Promise<{ snoozed: number }> {
  if (eventIds.length === 0) return { snoozed: 0 }

  const watchlist = await db.watchlist.findFirst({
    where: { userId },
    select: { items: { select: { instrumentId: true } } },
  })
  const owned = new Set((watchlist?.items ?? []).map((i) => i.instrumentId))

  const events = await db.event.findMany({
    where: { id: { in: eventIds } },
    select: { id: true, instrumentId: true },
  })
  const allowed = events.filter((e) => owned.has(e.instrumentId))

  for (const e of allowed) {
    await db.userEventState.upsert({
      where: { userId_eventId: { userId, eventId: e.id } },
      create: {
        userId,
        eventId: e.id,
        status: 'SNOOZED',
        snoozedUntil: until,
      },
      update: { status: 'SNOOZED', snoozedUntil: until },
    })
  }

  await invalidateUser(userId)
  return { snoozed: allowed.length }
}

/**
 * Plant an initial cursor for every watched name.
 *
 * A user with no cursor has no "since", and the first visit would otherwise
 * replay years of history as though they had just missed it.
 */
export async function ensureCursors(
  userId: string,
  at: Date = new Date(),
): Promise<number> {
  const watchlist = await db.watchlist.findFirst({
    where: { userId },
    include: { items: { select: { instrumentId: true } } },
  })
  if (!watchlist) return 0

  let planted = 0
  for (const item of watchlist.items) {
    const existing = await db.userWatchState.findUnique({
      where: { userId_instrumentId: { userId, instrumentId: item.instrumentId } },
    })
    if (existing) continue

    await db.userWatchState.create({
      data: {
        userId,
        instrumentId: item.instrumentId,
        lastSeenAt: at,
        lastSeenSnap: {},
        cursorVersion: BigInt(0),
      },
    })
    planted++
  }

  return planted
}
