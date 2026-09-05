import { describe, expect, it } from 'vitest'
import {
  isEarlyClose,
  isMarketOpen,
  isTradingDay,
  lastExpectedSession,
  nyDate,
  previousTradingDay,
  sessionsBehind,
  tradingDaysBetween,
} from '../market-calendar'

/**
 * The calendar is load-bearing for staleness, gap detection and scheduling,
 * so its failures would show up as three unrelated-looking bugs. Tested
 * against dates whose answers are known independently.
 */

describe('isTradingDay', () => {
  it('excludes weekends', () => {
    expect(isTradingDay('2026-09-04')).toBe(true) // Friday
    expect(isTradingDay('2026-09-05')).toBe(false) // Saturday
    expect(isTradingDay('2026-09-06')).toBe(false) // Sunday
    expect(isTradingDay('2026-09-07')).toBe(false) // Labor Day (Monday)
    expect(isTradingDay('2026-09-08')).toBe(true) // Tuesday
  })

  it('excludes known holidays', () => {
    expect(isTradingDay('2025-01-01')).toBe(false) // New Year
    expect(isTradingDay('2025-06-19')).toBe(false) // Juneteenth
    expect(isTradingDay('2025-11-27')).toBe(false) // Thanksgiving
    expect(isTradingDay('2025-01-09')).toBe(false) // Carter national day of mourning
  })

  it('includes ordinary days around them', () => {
    expect(isTradingDay('2025-11-26')).toBe(true)
    expect(isTradingDay('2025-11-28')).toBe(true) // early close, still a session
  })
})

describe('early closes', () => {
  it('knows the half days', () => {
    expect(isEarlyClose('2025-11-28')).toBe(true)
    expect(isEarlyClose('2025-11-26')).toBe(false)
  })

  it('closes the market at 13:00 on them', () => {
    // 2025-11-28 is a Friday early close. 18:30Z is 13:30 EST — shut.
    expect(isMarketOpen(new Date('2025-11-28T17:30:00Z'))).toBe(true) // 12:30
    expect(isMarketOpen(new Date('2025-11-28T18:30:00Z'))).toBe(false) // 13:30
    // The same clock time on a normal session is open.
    expect(isMarketOpen(new Date('2025-12-01T18:30:00Z'))).toBe(true)
  })
})

describe('isMarketOpen', () => {
  it('is false before the open and after the close', () => {
    // 2026-09-04 is a Friday. EDT, so UTC-4.
    expect(isMarketOpen(new Date('2026-09-04T13:00:00Z'))).toBe(false) // 09:00
    expect(isMarketOpen(new Date('2026-09-04T13:35:00Z'))).toBe(true) // 09:35
    expect(isMarketOpen(new Date('2026-09-04T19:59:00Z'))).toBe(true) // 15:59
    expect(isMarketOpen(new Date('2026-09-04T20:01:00Z'))).toBe(false) // 16:01
  })

  it('is false all weekend', () => {
    expect(isMarketOpen(new Date('2026-09-05T15:00:00Z'))).toBe(false) // Saturday
    expect(isMarketOpen(new Date('2026-09-06T15:00:00Z'))).toBe(false) // Sunday
  })

  it('handles the DST boundary', () => {
    // 2026-01-15 is EST (UTC-5): 14:35Z is 09:35, open.
    expect(isMarketOpen(new Date('2026-01-15T14:35:00Z'))).toBe(true)
    // The same UTC time in July is 10:35 EDT — also open, but via a different
    // offset. The check that matters is 13:35Z: 08:35 EST (shut) vs 09:35 EDT.
    expect(isMarketOpen(new Date('2026-01-15T13:35:00Z'))).toBe(false)
    expect(isMarketOpen(new Date('2026-07-15T13:35:00Z'))).toBe(true)
  })
})

describe('tradingDaysBetween', () => {
  it('lists sessions and skips weekends', () => {
    // Mon 31 Aug 2026 to Fri 4 Sep 2026.
    expect(tradingDaysBetween('2026-08-31', '2026-09-04')).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
    ])
  })

  it('skips a holiday inside the range', () => {
    // Labor Day 2026-09-07 falls between these.
    const days = tradingDaysBetween('2026-09-04', '2026-09-09')
    expect(days).toEqual(['2026-09-04', '2026-09-08', '2026-09-09'])
    expect(days).not.toContain('2026-09-07')
  })
})

describe('previousTradingDay', () => {
  it('steps back over a weekend', () => {
    expect(previousTradingDay('2026-09-07')).toBe('2026-09-04')
  })

  it('steps back over a holiday and a weekend together', () => {
    expect(previousTradingDay('2026-09-08')).toBe('2026-09-04')
  })
})

describe('staleness', () => {
  it('does not call Friday data stale on a Saturday', () => {
    // The bug this whole module exists to prevent: `now - lastBar > 24h`
    // reports every weekend as an outage.
    const saturday = new Date('2026-09-05T15:00:00Z')
    expect(lastExpectedSession(saturday)).toBe('2026-09-04')
    expect(sessionsBehind('2026-09-04', saturday)).toBe(0)
  })

  it('does call Friday data stale once Tuesday has closed and settled', () => {
    // 2026-09-07 is Labor Day, so Tuesday is the next session. At 16:00 on
    // Tuesday, Friday's close is still the newest bar anyone should have -
    // Tuesday's does not exist yet, so 0 is the correct answer.
    const duringTuesday = new Date('2026-09-08T20:00:00Z')
    expect(sessionsBehind('2026-09-04', duringTuesday)).toBe(0)

    // After Tuesday's close plus the settle window, Friday's data is one
    // session behind. This is the case a fixed 24-hour rule gets wrong in
    // both directions.
    const afterTuesday = new Date('2026-09-08T21:45:00Z')
    expect(sessionsBehind('2026-09-04', afterTuesday)).toBe(1)
  })

  it('does not expect today’s bar during the session', () => {
    const midSession = new Date('2026-09-04T17:00:00Z') // 13:00 EDT
    expect(lastExpectedSession(midSession)).toBe('2026-09-03')
    expect(sessionsBehind('2026-09-03', midSession)).toBe(0)
  })

  it('expects it once the providers have settled', () => {
    // 16:00 close + 90 minutes settle = 17:30 EDT = 21:30Z.
    const afterSettle = new Date('2026-09-04T21:45:00Z')
    expect(lastExpectedSession(afterSettle)).toBe('2026-09-04')
    expect(sessionsBehind('2026-09-03', afterSettle)).toBe(1)
  })

  it('treats no data at all as infinitely stale', () => {
    expect(sessionsBehind(null, new Date('2026-09-04T21:45:00Z'))).toBe(Infinity)
  })
})

describe('nyDate', () => {
  it('rolls the date at New York midnight, not UTC midnight', () => {
    // 2026-09-05T02:00Z is still 2026-09-04 22:00 in New York.
    expect(nyDate(new Date('2026-09-05T02:00:00Z'))).toBe('2026-09-04')
    expect(nyDate(new Date('2026-09-05T12:00:00Z'))).toBe('2026-09-05')
  })
})
