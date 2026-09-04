import {
  isMarketOpen,
  isTradingDay,
  nyDate,
  nyMinutes,
} from './market-calendar'
import type { AuxKind } from './queue'

/**
 * When each kind of work should run.
 *
 * Different data has different cadence, and none of it should be fetched
 * against a closed market. Polling intraday bars every fifteen minutes around
 * the clock would spend roughly three quarters of a 800-credit daily budget
 * re-reading a market that has not moved since Friday.
 *
 * Pure, and takes the instant to reason about, so the decisions are testable
 * without waiting for a Tuesday.
 */

export interface Cadence {
  kind: AuxKind | 'bars'
  /** How often the scheduler considers this job, in milliseconds. */
  everyMs: number
  /** Whether it should actually run at this instant. */
  shouldRun: (at: Date) => boolean
  why: string
}

const MINUTE = 60_000

/**
 * How long after the close the daily bar is worth asking for.
 *
 * Providers do not publish a settled close at 16:00:00. Asking immediately
 * gets a provisional value that is then corrected, which shows up downstream
 * as a cross-source conflict that was never a real disagreement.
 */
const SETTLE_MINUTES = 90

export const CADENCES: Cadence[] = [
  {
    kind: 'bars',
    everyMs: 15 * MINUTE,
    // Only after the close has settled, and only on a session. Gap detection
    // makes a redundant run cheap - it enqueues nothing when nothing is
    // missing - but there is no reason to look before the data can exist.
    shouldRun: (at) => {
      const date = nyDate(at)
      if (!isTradingDay(date)) return false
      return nyMinutes(at) >= 16 * 60 + SETTLE_MINUTES
    },
    why: 'daily bars, after the close has settled',
  },
  {
    kind: 'intraday',
    everyMs: 15 * MINUTE,
    // Market hours only. This is the one that would otherwise waste the most
    // quota, because it is the most frequent.
    shouldRun: isMarketOpen,
    why: 'intraday bars, during the session only',
  },
  {
    kind: 'news',
    everyMs: 30 * MINUTE,
    // A little either side of the session: stories break before the open and
    // after the close, and the free tier only retains ~2 days anyway.
    shouldRun: (at) => {
      const date = nyDate(at)
      if (!isTradingDay(date)) return false
      const m = nyMinutes(at)
      return m >= 7 * 60 && m <= 20 * 60
    },
    why: 'news, through the extended session',
  },
  {
    kind: 'earnings',
    everyMs: 12 * 60 * MINUTE,
    // A forward calendar. Twice a day is generous for something that changes
    // when a company issues a press release.
    shouldRun: (at) => isTradingDay(nyDate(at)),
    why: 'earnings calendar, twice daily',
  },
  {
    kind: 'maintenance',
    everyMs: 60 * MINUTE,
    // Sweeping expired sessions and old intraday bars has nothing to do with
    // the market, so it runs regardless.
    shouldRun: () => true,
    why: 'housekeeping, always',
  },
]

/** Everything due to run at this instant. */
export function dueAt(at: Date): Cadence[] {
  return CADENCES.filter((c) => c.shouldRun(at))
}
