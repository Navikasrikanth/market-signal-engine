import { describe, expect, it } from 'vitest'
import {
  contextSentence,
  matchContext,
  scoreContext,
  MIN_CONTEXT_CONFIDENCE,
  NO_CONTEXT_SENTENCE,
  type ContextEvent,
} from '../context'

/**
 * The decisive property is not that context is attached — it is that the
 * engine never claims causation, and says nothing at all rather than
 * attaching the nearest available headline.
 */

const covid: ContextEvent = {
  id: 'covid',
  eventDate: '2020-03-09',
  eventEndDate: '2020-03-23',
  title: 'the escalation of the COVID-19 pandemic',
  description: 'WHO declared a pandemic on 11 March 2020.',
  category: 'PUBLIC_HEALTH',
  scope: 'GLOBAL',
  importance: 'HIGH',
  source: 'WHO',
  sourceUrl: null,
  sectors: [],
}

const svb: ContextEvent = {
  id: 'svb',
  eventDate: '2023-03-10',
  eventEndDate: '2023-03-13',
  title: 'the failure of Silicon Valley Bank',
  description: 'SVB was closed by regulators on 10 March 2023.',
  category: 'FINANCIAL_CRISIS',
  scope: 'SECTOR',
  importance: 'HIGH',
  source: 'FDIC',
  sourceUrl: null,
  sectors: ['Financials'],
}

describe('matchContext', () => {
  it('matches a market-wide crash to a global event', () => {
    const match = matchContext(
      { date: '2020-03-16', marketWide: true, sector: null },
      [covid, svb],
    )!

    expect(match.event.id).toBe('covid')
    expect(match.band).toBe('HIGH')
    // Inside the episode, proximity is maximal - the connection is strongest
    // in the middle of a fortnight, not only on its first day.
    expect(match.components.proximity).toBe(1)
  })

  it('returns nothing when no context is near', () => {
    // The common case, and the one that matters most: most market moves have
    // no entry in a curated table.
    expect(
      matchContext({ date: '2021-07-14', marketWide: true, sector: null }, [
        covid,
        svb,
      ]),
    ).toBeNull()
  })

  it('does not attach a global macro event to one company’s own move', () => {
    const match = matchContext(
      { date: '2020-03-16', marketWide: false, sector: 'Information Technology' },
      [covid],
    )

    // A stock that fell on its own results that day is not explained by a
    // pandemic, and saying so would be the exact failure this guards against.
    expect(match).toBeNull()
  })

  it('matches a sector event to that sector', () => {
    const match = matchContext(
      { date: '2023-03-13', marketWide: false, sector: 'Financials' },
      [svb],
    )!
    expect(match.event.id).toBe('svb')
  })

  it('does NOT match a sector event to a different sector', () => {
    expect(
      matchContext(
        { date: '2023-03-13', marketWide: false, sector: 'Energy' },
        [svb],
      ),
    ).toBeNull()
  })

  it('ignores anything outside the proximity window', () => {
    expect(
      scoreContext({ date: '2020-04-30', marketWide: true, sector: null }, covid),
    ).toBeNull()
  })

  it('holds a confidence floor', () => {
    const weak: ContextEvent = { ...svb, importance: 'LOW', scope: 'REGIONAL' }
    const match = matchContext(
      { date: '2023-03-16', marketWide: false, sector: 'Energy' },
      [weak],
    )
    expect(match).toBeNull()
    expect(MIN_CONTEXT_CONFIDENCE).toBeGreaterThan(0)
  })
})

describe('contextSentence', () => {
  it('never claims causation', () => {
    const match = matchContext(
      { date: '2020-03-16', marketWide: true, sector: null },
      [covid],
    )!
    const sentence = contextSentence(match)

    // The whole point. Every construction is temporal.
    expect(sentence).toMatch(/coincided with/)
    expect(sentence).not.toMatch(/caused|because|due to|led to|triggered/i)
  })

  it('hedges harder as confidence falls', () => {
    const high = matchContext(
      { date: '2020-03-16', marketWide: true, sector: null },
      [covid],
    )!
    const lower = matchContext(
      { date: '2023-03-15', marketWide: false, sector: 'Financials' },
      [{ ...svb, importance: 'MEDIUM' }],
    )!

    expect(contextSentence(high)).toMatch(/coincided with/)
    expect(contextSentence(lower)).not.toMatch(/coincided with/)
    for (const s of [contextSentence(high), contextSentence(lower)]) {
      expect(s).not.toMatch(/caused|because|due to/i)
    }
  })

  it('has a fixed sentence for having nothing to say', () => {
    expect(NO_CONTEXT_SENTENCE).toMatch(/No major contextual event/)
    expect(NO_CONTEXT_SENTENCE).not.toMatch(/caused|likely|probably/i)
  })
})
