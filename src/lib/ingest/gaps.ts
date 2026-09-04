import { db } from '../db'
import {
  lastExpectedSession,
  sessionsBehind,
  tradingDaysBetween,
} from '../market-calendar'

/**
 * What data is missing, and where.
 *
 * The previous ingest window was a fixed ten-day lookback, which has two
 * failure modes and hits both:
 *
 *   - an outage longer than ten days leaves a hole that never heals, because
 *     every subsequent run asks only for the last ten days
 *   - `MAX(barDate)` finds the tail and nothing else. Stored 1, 2, 4, 5
 *     returns 5, and the series reports itself healthy while the 3rd is
 *     missing entirely
 *
 * Both are answered the same way: ask the calendar which sessions should
 * exist, compare against the sessions that do, and repair the difference.
 */

export interface InstrumentGaps {
  symbol: string
  instrumentId: string
  /** Newest stored session, or null when the instrument has no bars at all. */
  latest: string | null
  /** Sessions after `latest` that should exist by now. */
  tail: string[]
  /** Sessions missing from inside the stored range — the invisible failure. */
  holes: string[]
  /** How far behind the newest stored bar is, in sessions. */
  sessionsBehind: number
}

/**
 * Cap on how far back a repair reaches.
 *
 * Without a bound, an instrument added today would try to backfill its entire
 * history one missing date at a time through a rate-limited provider. Deep
 * history is the backfill script's job; this keeps the running system honest.
 */
const MAX_REPAIR_SESSIONS = 90

/** Holes are only meaningful inside a range the provider actually covers. */
const HOLE_SCAN_SESSIONS = 250

export async function findGaps(
  at: Date = new Date(),
  symbols?: string[],
): Promise<InstrumentGaps[]> {
  const instruments = await db.instrument.findMany({
    where: { isActive: true, ...(symbols ? { symbol: { in: symbols } } : {}) },
    select: { id: true, symbol: true },
    orderBy: { symbol: 'asc' },
  })

  const expectedLatest = lastExpectedSession(at)
  const out: InstrumentGaps[] = []

  for (const inst of instruments) {
    const rows = await db.dailyBar.findMany({
      where: { instrumentId: inst.id },
      select: { barDate: true },
      orderBy: { barDate: 'desc' },
      take: HOLE_SCAN_SESSIONS,
    })

    if (rows.length === 0) {
      out.push({
        symbol: inst.symbol,
        instrumentId: inst.id,
        latest: null,
        tail: [],
        holes: [],
        sessionsBehind: Infinity,
      })
      continue
    }

    const stored = new Set(rows.map((r) => r.barDate.toISOString().slice(0, 10)))
    const dates = [...stored].sort()
    const latest = dates[dates.length - 1]
    const earliest = dates[0]

    // Tail: sessions after the newest stored bar that should already exist.
    const tail = tradingDaysBetween(latest, expectedLatest)
      .filter((d) => d > latest)
      .slice(-MAX_REPAIR_SESSIONS)

    // Holes: sessions inside the stored range that are absent. Calendar-driven,
    // so a weekend or a holiday is never mistaken for missing data.
    const holes = tradingDaysBetween(earliest, latest).filter(
      (d) => !stored.has(d),
    )

    out.push({
      symbol: inst.symbol,
      instrumentId: inst.id,
      latest,
      tail,
      holes,
      sessionsBehind: sessionsBehind(latest, at),
    })
  }

  return out
}

/**
 * The window one instrument should be fetched over.
 *
 * Returns null when nothing is missing — the caller can then skip the request
 * entirely rather than spending provider quota re-fetching what it already
 * has. A hole makes the window reach back to cover it, because providers serve
 * ranges rather than individual dates.
 */
export function repairWindow(
  gaps: InstrumentGaps,
): { from: string; to: string } | null {
  const missing = [...gaps.holes, ...gaps.tail].sort()
  if (missing.length === 0) return null

  return { from: missing[0], to: missing[missing.length - 1] }
}

/** Summary for the ops page and the brief's staleness warning. */
export interface GapSummary {
  worstSessionsBehind: number
  instrumentsBehind: number
  totalHoles: number
  instrumentsWithHoles: string[]
  latestStored: string | null
}

export function summariseGaps(gaps: InstrumentGaps[]): GapSummary {
  const withHoles = gaps.filter((g) => g.holes.length > 0)
  const finiteLatest = gaps
    .map((g) => g.latest)
    .filter((d): d is string => d !== null)
    .sort()

  return {
    worstSessionsBehind: gaps.reduce(
      (worst, g) => Math.max(worst, g.sessionsBehind),
      0,
    ),
    instrumentsBehind: gaps.filter((g) => g.sessionsBehind > 0).length,
    totalHoles: gaps.reduce((n, g) => n + g.holes.length, 0),
    instrumentsWithHoles: withHoles.map((g) => g.symbol),
    latestStored: finiteLatest[finiteLatest.length - 1] ?? null,
  }
}
