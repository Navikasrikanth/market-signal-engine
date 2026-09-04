import { describe, expect, it } from 'vitest'
import { CADENCES, dueAt } from '../schedule'

/**
 * The scheduler's job is mostly to say NO. Fetching a closed market is the
 * expensive mistake: intraday polling every fifteen minutes around the clock
 * would spend most of a daily quota re-reading a market that has not moved
 * since Friday.
 */

function kinds(at: Date): string[] {
  return dueAt(at).map((c) => c.kind).sort()
}

describe('cadences', () => {
  it('runs nothing market-facing at the weekend', () => {
    // Saturday.
    expect(kinds(new Date('2026-09-05T15:00:00Z'))).toEqual(['maintenance'])
  })

  it('runs nothing market-facing on a holiday', () => {
    // Labor Day, Monday 2026-09-07, during what would be the session.
    expect(kinds(new Date('2026-09-07T17:00:00Z'))).toEqual(['maintenance'])
  })

  it('polls intraday only while the market is open', () => {
    // Friday 2026-09-04. EDT, so UTC-4.
    expect(kinds(new Date('2026-09-04T17:00:00Z'))).toContain('intraday') // 13:00
    expect(kinds(new Date('2026-09-04T12:00:00Z'))).not.toContain('intraday') // 08:00
    expect(kinds(new Date('2026-09-04T21:00:00Z'))).not.toContain('intraday') // 17:00
  })

  it('does not fetch the daily bar until the close has settled', () => {
    // 16:00 close + 90 minutes = 17:30 EDT = 21:30Z.
    expect(kinds(new Date('2026-09-04T19:00:00Z'))).not.toContain('bars') // 15:00
    expect(kinds(new Date('2026-09-04T20:30:00Z'))).not.toContain('bars') // 16:30
    expect(kinds(new Date('2026-09-04T21:45:00Z'))).toContain('bars') // 17:45
  })

  it('keeps housekeeping running regardless of the market', () => {
    for (const at of [
      '2026-09-05T03:00:00Z', // Saturday, small hours
      '2026-09-07T17:00:00Z', // holiday
      '2026-09-04T17:00:00Z', // mid-session
    ]) {
      expect(kinds(new Date(at))).toContain('maintenance')
    }
  })

  it('gives the most frequent job the tightest market gate', () => {
    // Not a behavioural assertion so much as a design one: whatever runs
    // every 15 minutes must be the thing most carefully gated, because it is
    // the one that can burn a daily quota before lunchtime.
    const intraday = CADENCES.find((c) => c.kind === 'intraday')!
    const earnings = CADENCES.find((c) => c.kind === 'earnings')!
    expect(intraday.everyMs).toBeLessThan(earnings.everyMs)
    expect(intraday.shouldRun(new Date('2026-09-04T21:00:00Z'))).toBe(false)
  })
})
