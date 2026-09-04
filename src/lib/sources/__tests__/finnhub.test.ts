import { describe, expect, it } from 'vitest'
import { headlineKey, rankNews } from '../finnhub'
import type { RawNews } from '../types'

/**
 * The design claim being tested: coverage is ranked by how many DISTINCT
 * outlets carried a story, never by how many articles exist. The provider
 * returned 249 articles for one ticker over two days, from five outlets —
 * counting articles would measure syndication cadence and call it importance.
 */

function article(overrides: Partial<RawNews> = {}): RawNews {
  return {
    publishedAt: '2026-09-04T13:00:00.000Z',
    headline: 'NVIDIA beats on earnings, raises guidance',
    source: 'Reuters',
    url: 'https://example.com/a',
    summary: null,
    ...overrides,
  }
}

describe('headlineKey', () => {
  it('collapses punctuation, casing and word order', () => {
    expect(headlineKey('NVIDIA beats on earnings!')).toBe(
      headlineKey('nvidia BEATS on Earnings'),
    )
  })

  it('keeps genuinely different stories apart', () => {
    expect(headlineKey('NVIDIA beats on earnings')).not.toBe(
      headlineKey('NVIDIA announces a stock split'),
    )
  })
})

describe('rankNews', () => {
  it('collapses forty syndicated copies into one row', () => {
    // The shape of the real payload: one story, three outlets, many posts.
    const flood: RawNews[] = []
    for (let i = 0; i < 40; i++) {
      flood.push(
        article({
          source: ['ChartMill', 'Zacks', 'Reuters'][i % 3],
          url: `https://example.com/${i}`,
        }),
      )
    }

    const ranked = rankNews('NVDA', flood)

    expect(ranked).toHaveLength(1)
    expect(ranked[0].corroboration).toBe(3)
  })

  it('ranks by outlets, not by article count', () => {
    // A story four outlets picked up, against one outlet posting ten times.
    const items: RawNews[] = []
    for (let i = 0; i < 10; i++) {
      items.push(
        article({
          headline: 'NVIDIA schedules an investor webinar',
          source: 'ChartMill',
          url: `https://example.com/spam-${i}`,
        }),
      )
    }
    for (const outlet of ['Reuters', 'Bloomberg', 'CNBC', 'WSJ']) {
      items.push(
        article({
          headline: 'NVIDIA loses its largest customer',
          source: outlet,
          url: `https://example.com/${outlet}`,
        }),
      )
    }

    const ranked = rankNews('NVDA', items)

    expect(ranked[0].headline).toMatch(/largest customer/)
    expect(ranked[0].corroboration).toBe(4)
    expect(ranked[1].corroboration).toBe(1)
  })

  it('keeps the earliest telling of a story', () => {
    const ranked = rankNews('NVDA', [
      article({ publishedAt: '2026-09-04T15:00:00.000Z', source: 'Zacks' }),
      article({ publishedAt: '2026-09-04T09:30:00.000Z', source: 'Reuters' }),
    ])

    expect(ranked[0].publishedAt).toBe('2026-09-04T09:30:00.000Z')
    expect(ranked[0].corroboration).toBe(2)
  })

  it('separates the same headline on different days', () => {
    const ranked = rankNews('NVDA', [
      article({ publishedAt: '2026-09-03T13:00:00.000Z' }),
      article({ publishedAt: '2026-09-04T13:00:00.000Z' }),
    ])

    expect(ranked).toHaveLength(2)
  })

  it('caps how much it keeps', () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      article({ headline: `Distinct story number ${i} about the company` }),
    )
    expect(rankNews('NVDA', many).length).toBeLessThanOrEqual(10)
  })
})
