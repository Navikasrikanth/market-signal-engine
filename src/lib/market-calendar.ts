/**
 * The US equity market calendar.
 *
 * Load-bearing for three separate things that were all previously wrong or
 * missing: what "stale" means, which dates count as a gap, and when it is
 * worth calling a provider at all.
 *
 * The naive versions of each are subtly broken. `now - lastBar > 24h` flags
 * every Saturday. `MAX(barDate)` finds a tail gap but never an internal hole.
 * A 15-minute intraday poll that ignores the calendar spends a third of its
 * quota fetching a closed market.
 *
 * Pure: no database, no network, no ambient clock — every function takes the
 * instant it should reason about. That is what makes it testable against known
 * holidays instead of against whatever today happens to be.
 *
 * Deliberately US-only and hard-coded through 2027. A calendar service is the
 * correct answer for a real product; for a fixed universe of US equities over
 * a known window, a table that can be read and checked by eye is better than a
 * dependency that cannot.
 */

/** New York offset from UTC, in hours. -4 during DST, -5 otherwise. */
function nyOffsetHours(utc: Date): number {
  // US DST: second Sunday in March to first Sunday in November.
  const year = utc.getUTCFullYear()
  const marchSecondSunday = nthWeekdayUtc(year, 2, 0, 2)
  const novemberFirstSunday = nthWeekdayUtc(year, 10, 0, 1)

  // Transitions happen at 2am local; hour-level precision is irrelevant here
  // because every decision this module makes is at day or session granularity.
  const t = utc.getTime()
  return t >= marchSecondSunday.getTime() && t < novemberFirstSunday.getTime()
    ? -4
    : -5
}

function nthWeekdayUtc(
  year: number,
  month: number,
  weekday: number,
  n: number,
): Date {
  const first = new Date(Date.UTC(year, month, 1))
  const shift = (weekday - first.getUTCDay() + 7) % 7
  return new Date(Date.UTC(year, month, 1 + shift + (n - 1) * 7, 7))
}

/** The New York calendar date for an instant, as `YYYY-MM-DD`. */
export function nyDate(at: Date): string {
  const shifted = new Date(at.getTime() + nyOffsetHours(at) * 3_600_000)
  return shifted.toISOString().slice(0, 10)
}

/** Minutes past New York midnight for an instant. */
export function nyMinutes(at: Date): number {
  const shifted = new Date(at.getTime() + nyOffsetHours(at) * 3_600_000)
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
}

/**
 * NYSE/Nasdaq full closures, 2019–2027.
 *
 * Covers the fixture history and comfortably beyond. A date missing from this
 * list is treated as a trading day, which fails in the safe direction: the
 * system looks for data that is not there and reports a gap, rather than
 * silently accepting a hole.
 */
const HOLIDAYS = new Set<string>([
  // 2019
  '2019-01-01', '2019-01-21', '2019-02-18', '2019-04-19', '2019-05-27',
  '2019-07-04', '2019-09-02', '2019-11-28', '2019-12-25',
  // 2020
  '2020-01-01', '2020-01-20', '2020-02-17', '2020-04-10', '2020-05-25',
  '2020-07-03', '2020-09-07', '2020-11-26', '2020-12-25',
  // 2021
  '2021-01-01', '2021-01-18', '2021-02-15', '2021-04-02', '2021-05-31',
  '2021-07-05', '2021-09-06', '2021-11-25', '2021-12-24',
  // 2022
  '2022-01-17', '2022-02-21', '2022-04-15', '2022-05-30', '2022-06-20',
  '2022-07-04', '2022-09-05', '2022-11-24', '2022-12-26',
  // 2023
  '2023-01-02', '2023-01-16', '2023-02-20', '2023-04-07', '2023-05-29',
  '2023-06-19', '2023-07-04', '2023-09-04', '2023-11-23', '2023-12-25',
  // 2024
  '2024-01-01', '2024-01-15', '2024-02-19', '2024-03-29', '2024-05-27',
  '2024-06-19', '2024-07-04', '2024-09-02', '2024-11-28', '2024-12-25',
  // 2025
  '2025-01-01', '2025-01-09', '2025-01-20', '2025-02-17', '2025-04-18',
  '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27',
  '2025-12-25',
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
])

/**
 * Sessions closing at 13:00 instead of 16:00.
 *
 * These matter for exactly one reason: at 15:30 on an early-close day the
 * market is shut, and an intraday poll expecting a 16:00 bar would report the
 * data stale when it is complete.
 */
const EARLY_CLOSES = new Set<string>([
  '2019-07-03', '2019-11-29', '2019-12-24',
  '2020-11-27', '2020-12-24',
  '2021-11-26',
  '2022-11-25',
  '2023-07-03', '2023-11-24',
  '2024-07-03', '2024-11-29', '2024-12-24',
  '2025-07-03', '2025-11-28', '2025-12-24',
  '2026-11-27', '2026-12-24',
  '2027-11-26',
])

export const MARKET_OPEN_MINUTES = 9 * 60 + 30
export const REGULAR_CLOSE_MINUTES = 16 * 60
export const EARLY_CLOSE_MINUTES = 13 * 60

/** Is this `YYYY-MM-DD` a trading session? */
export function isTradingDay(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay()
  if (day === 0 || day === 6) return false
  return !HOLIDAYS.has(date)
}

export function isEarlyClose(date: string): boolean {
  return EARLY_CLOSES.has(date)
}

export function closeMinutes(date: string): number {
  return isEarlyClose(date) ? EARLY_CLOSE_MINUTES : REGULAR_CLOSE_MINUTES
}

/** Is the market open for regular trading at this instant? */
export function isMarketOpen(at: Date): boolean {
  const date = nyDate(at)
  if (!isTradingDay(date)) return false

  const minutes = nyMinutes(at)
  return minutes >= MARKET_OPEN_MINUTES && minutes < closeMinutes(date)
}

/** The previous trading day strictly before `date`. */
export function previousTradingDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`)
  for (let i = 0; i < 15; i++) {
    d.setUTCDate(d.getUTCDate() - 1)
    const candidate = d.toISOString().slice(0, 10)
    if (isTradingDay(candidate)) return candidate
  }
  throw new Error(`no trading day found before ${date}`)
}

/**
 * Every trading session in `[from, to]`, inclusive.
 *
 * This is what makes internal-hole detection possible: comparing stored dates
 * against a real calendar rather than against `MAX(barDate)`, which reports a
 * series as healthy while a date in the middle of it is missing.
 */
export function tradingDaysBetween(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(`${from}T12:00:00Z`)
  const end = new Date(`${to}T12:00:00Z`)

  while (d.getTime() <= end.getTime()) {
    const date = d.toISOString().slice(0, 10)
    if (isTradingDay(date)) out.push(date)
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

/**
 * The most recent session whose daily bar should already exist.
 *
 * The subtlety that makes naive staleness checks wrong: during a session, and
 * for a short while after the close, today's bar does not exist yet and its
 * absence is not a fault. Providers also need time to settle, so a bar is only
 * "expected" once `SETTLE_MINUTES` have passed since the close.
 */
const SETTLE_MINUTES = 90

export function lastExpectedSession(at: Date): string {
  const today = nyDate(at)
  const minutes = nyMinutes(at)

  if (isTradingDay(today) && minutes >= closeMinutes(today) + SETTLE_MINUTES) {
    return today
  }
  return previousTradingDay(today)
}

/**
 * How stale the data is, in sessions. Zero means current.
 *
 * Expressed in sessions rather than hours precisely so a weekend is not
 * staleness: Friday's close read on a Saturday is 0 sessions behind, while the
 * same close read on Tuesday afternoon is 2.
 */
export function sessionsBehind(latestStored: string | null, at: Date): number {
  if (!latestStored) return Infinity
  const expected = lastExpectedSession(at)
  if (latestStored >= expected) return 0
  return tradingDaysBetween(latestStored, expected).length - 1
}
