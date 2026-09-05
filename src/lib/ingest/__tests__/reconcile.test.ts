import { describe, expect, it } from 'vitest'
import {
  abnormality,
  reconcileBar,
  reconcileSeries,
  TOLERANCE,
  type SourcedBar,
} from '../reconcile'
import { validateBars } from '../validate'
import type { RawBar } from '../../sources/types'

function bar(overrides: Partial<RawBar> = {}): RawBar {
  return {
    date: '2024-06-03',
    open: 100,
    high: 102,
    low: 99,
    close: 101,
    closeAdj: 101,
    volume: 1_000_000,
    ...overrides,
  }
}

function sourced(
  sourceId: string,
  trustRank: number,
  overrides: Partial<RawBar> = {},
): SourcedBar {
  return { sourceId, trustRank, bar: bar(overrides) }
}

describe('reconcileBar', () => {
  it('returns null when no source has the bar', () => {
    expect(reconcileBar([])).toBeNull()
  })

  it('accepts a single source with reduced confidence and no conflict', () => {
    const r = reconcileBar([sourced('twelvedata', 1)])!
    expect(r.source).toBe('twelvedata')
    expect(r.confirmed).toBe(true)
    // Uncorroborated is not the same as disputed, but it is worth less than
    // two sources that agree.
    expect(r.confidence).toBeLessThan(1)
    expect(r.conflicts).toHaveLength(0)
  })

  it('takes the higher-trust value when sources agree', () => {
    const r = reconcileBar([
      sourced('tiingo', 2, { close: 101.05 }),
      sourced('twelvedata', 1, { close: 101.0 }),
    ])!

    expect(r.source).toBe('twelvedata')
    expect(r.bar.close).toBe(101.0)
    expect(r.confirmed).toBe(true)
    expect(r.confidence).toBe(1)
    expect(r.conflicts).toHaveLength(0)
  })

  it('marks a bar unconfirmed when prices disagree beyond tolerance', () => {
    const r = reconcileBar([
      sourced('twelvedata', 1, { close: 101 }),
      sourced('tiingo', 2, { close: 108 }),
    ])!

    expect(r.confirmed).toBe(false)
    expect(r.confidence).toBeLessThan(1)
    expect(r.conflicts.some((c) => c.field === 'close')).toBe(true)

    const conflict = r.conflicts.find((c) => c.field === 'close')!
    // Both values are retained so the UI can show what each source said.
    expect(conflict.valueA).toBe(101)
    expect(conflict.valueB).toBe(108)
    expect(conflict.resolvedTo).toBe('twelvedata')
  })

  it('degrades confidence further as the disagreement widens', () => {
    const small = reconcileBar([
      sourced('twelvedata', 1, { close: 100 }),
      sourced('tiingo', 2, { close: 100.6 }),
    ])!
    const large = reconcileBar([
      sourced('twelvedata', 1, { close: 100 }),
      sourced('tiingo', 2, { close: 130 }),
    ])!

    expect(large.confidence).toBeLessThan(small.confidence)
    expect(large.confidence).toBeGreaterThanOrEqual(0.5)
  })

  it('stays confirmed for a price difference inside tolerance', () => {
    const withinTolerance = 100 * (1 + TOLERANCE.price * 0.5)
    const r = reconcileBar([
      sourced('twelvedata', 1, { close: 100 }),
      sourced('tiingo', 2, { close: withinTolerance }),
    ])!
    expect(r.confirmed).toBe(true)
  })

  it('records a volume disagreement WITHOUT marking the bar unconfirmed', () => {
    // Vendors legitimately differ on daily volume (consolidated tape vs primary
    // listing). Treating that as a data dispute would flag nearly every bar and
    // train users to ignore the badge entirely.
    const r = reconcileBar([
      sourced('twelvedata', 1, { volume: 1_000_000 }),
      sourced('tiingo', 2, { volume: 1_800_000 }),
    ])!

    expect(r.conflicts.some((c) => c.field === 'volume')).toBe(true)
    expect(r.confirmed).toBe(true)
    expect(r.confidence).toBe(1)
  })
})

describe('reconcileSeries', () => {
  it('joins on date rather than position', () => {
    // The primary is missing 2024-06-04. Positional pairing would compare
    // 06-05 against 06-04 and manufacture a conflict on every later bar.
    const primary = [
      bar({ date: '2024-06-03', close: 100 }),
      bar({ date: '2024-06-05', close: 102 }),
    ]
    const secondary = [
      bar({ date: '2024-06-03', close: 100 }),
      bar({ date: '2024-06-04', close: 101 }),
      bar({ date: '2024-06-05', close: 102 }),
    ]

    const result = reconcileSeries([
      { sourceId: 'twelvedata', trustRank: 1, bars: primary },
      { sourceId: 'tiingo', trustRank: 2, bars: secondary },
    ])

    expect(result.conflicts).toHaveLength(0)
    expect(result.bars).toHaveLength(3)
    expect(result.bars.map((b) => b.bar.date)).toEqual([
      '2024-06-03',
      '2024-06-04',
      '2024-06-05',
    ])
  })

  it('reports a session only the secondary had as a filled gap', () => {
    const result = reconcileSeries([
      { sourceId: 'twelvedata', trustRank: 1, bars: [bar({ date: '2024-06-03' })] },
      {
        sourceId: 'tiingo',
        trustRank: 2,
        bars: [bar({ date: '2024-06-03' }), bar({ date: '2024-06-04' })],
      },
    ])

    expect(result.gapsFilled).toEqual(['2024-06-04'])
    // The gap-filled bar came from a single source, so it is not fully confirmed.
    const filled = result.bars.find((b) => b.bar.date === '2024-06-04')!
    expect(filled.confidence).toBeLessThan(1)
  })

  it('attaches the date to every conflict so it can be persisted', () => {
    const result = reconcileSeries([
      { sourceId: 'twelvedata', trustRank: 1, bars: [bar({ close: 100 })] },
      { sourceId: 'tiingo', trustRank: 2, bars: [bar({ close: 115 })] },
    ])

    expect(result.conflicts.length).toBeGreaterThan(0)
    expect(result.conflicts[0].date).toBe('2024-06-03')
  })

  it('returns bars in chronological order', () => {
    const result = reconcileSeries([
      {
        sourceId: 'twelvedata',
        trustRank: 1,
        bars: [
          bar({ date: '2024-06-05' }),
          bar({ date: '2024-06-03' }),
          bar({ date: '2024-06-04' }),
        ],
      },
    ])
    expect(result.bars.map((b) => b.bar.date)).toEqual([
      '2024-06-03',
      '2024-06-04',
      '2024-06-05',
    ])
  })
})

describe('validateBars', () => {
  it('accepts a clean series', () => {
    const { valid, rejected } = validateBars([
      bar({ date: '2024-06-03' }),
      bar({ date: '2024-06-04' }),
    ])
    expect(valid).toHaveLength(2)
    expect(rejected).toHaveLength(0)
  })

  it('rejects non-positive prices with a reason', () => {
    const { valid, rejected } = validateBars([bar({ close: 0 })])
    expect(valid).toHaveLength(0)
    expect(rejected[0].reason).toMatch(/must be positive/)
  })

  it('rejects a bar whose range does not contain its own prices', () => {
    const { rejected } = validateBars([bar({ high: 100, low: 99, close: 105 })])
    expect(rejected[0].reason).toMatch(/high is below/)
  })

  it('rejects duplicate dates', () => {
    const { valid, rejected } = validateBars([
      bar({ date: '2024-06-03' }),
      bar({ date: '2024-06-03' }),
    ])
    expect(valid).toHaveLength(1)
    expect(rejected[0].reason).toMatch(/duplicate/)
  })

  it('rejects a session move too large to be a real security', () => {
    const { valid, rejected } = validateBars([
      bar({ date: '2024-06-03', open: 100, high: 102, low: 99, close: 100 }),
      bar({ date: '2024-06-04', open: 20, high: 21, low: 19, close: 20 }),
    ])

    expect(valid).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toMatch(/treating the row as corrupt/)
  })

  it('does NOT try to catch a 2:1 split by magnitude', () => {
    // Documents a real limitation rather than hiding it. A 2:1 split is a 50%
    // drop, which is indistinguishable by size from a genuine collapse, so this
    // validator deliberately lets it through. Split adjustment is the
    // provider's job and arrives via closeAdj — if that contract ever breaks,
    // this test is where the assumption is written down.
    const { valid, rejected } = validateBars([
      bar({ date: '2024-06-03', open: 100, high: 102, low: 99, close: 100 }),
      bar({ date: '2024-06-04', open: 50, high: 51, low: 49, close: 50 }),
    ])

    expect(valid).toHaveLength(2)
    expect(rejected).toHaveLength(0)
  })

  it('does not apply the session-move check across a gap in the series', () => {
    // A trimmed fixture, or a symbol that stopped trading and resumed, leaves a
    // gap. The price difference across it is not a session move and must not be
    // judged as one - this exact bug rejected 9,008 valid rows when loading the
    // committed fixtures, whose windows are deliberately non-contiguous.
    const { valid, rejected } = validateBars([
      bar({ date: '2020-03-31', open: 100, high: 102, low: 99, close: 100 }),
      bar({ date: '2022-09-01', open: 300, high: 305, low: 295, close: 300 }),
    ])

    expect(valid).toHaveLength(2)
    expect(rejected).toHaveLength(0)
  })

  it('still applies it across a weekend', () => {
    // Friday to Monday is three calendar days but one session apart, so a 70%
    // move there is still corrupt.
    const { valid, rejected } = validateBars([
      bar({ date: '2024-06-07', open: 100, high: 102, low: 99, close: 100 }),
      bar({ date: '2024-06-10', open: 20, high: 21, low: 19, close: 20 }),
    ])

    expect(valid).toHaveLength(1)
    expect(rejected).toHaveLength(1)
  })

  it('never silently drops a row — every rejection carries a reason', () => {
    // A data outage that looks like a quiet market is the most dangerous
    // failure this product can have.
    const { rejected } = validateBars([
      bar({ close: -5 }),
      bar({ date: 'not-a-date' }),
      bar({ date: '2024-06-06', volume: -1 }),
    ])

    expect(rejected).toHaveLength(3)
    for (const r of rejected) {
      expect(r.reason.length).toBeGreaterThan(0)
    }
  })
})

describe('sanity beats trust', () => {
  /** A $180 stock that moves about 1.5% a session. */
  const history = {
    recentCloses: [175, 178, 181, 177, 180, 179, 182, 178],
  }

  it('rejects a decimal-shift glitch from the HIGHER-trust provider', () => {
    // The case this exists for. Twelve Data is trustRank 1, so the old code
    // stored $18 and marked the bar merely "unconfirmed" - a corrupt price
    // presented as a mild disagreement.
    const result = reconcileBar(
      [
        sourced('twelvedata', 1, { close: 18, open: 18, high: 18.2, low: 17.9 }),
        sourced('tiingo', 2, { close: 180, open: 179, high: 181, low: 178 }),
      ],
      history,
    )!

    expect(result.bar.close).toBe(180)
    expect(result.source).toBe('tiingo')

    const closeConflict = result.conflicts.find((c) => c.field === 'close')!
    expect(closeConflict.resolvedTo).toBe('tiingo')
    expect(closeConflict.resolvedValue).toBe(180)
    expect(closeConflict.reason).toBe('PRIMARY_VALUE_FAILED_HISTORY_SANITY')
    expect(closeConflict.trustOverride).toBe(true)
  })

  it('does NOT override for a legitimate high-volatility move', () => {
    // A 20% move is enormous, and for a name that routinely moves 15% it is
    // not evidence of corruption. A fixed percentage threshold gets this
    // wrong; measuring against the instrument's own behaviour does not.
    const volatile = {
      recentCloses: [100, 118, 96, 112, 99, 115, 101, 120],
    }

    const result = reconcileBar(
      [
        sourced('twelvedata', 1, { close: 144 }),
        sourced('tiingo', 2, { close: 120 }),
      ],
      volatile,
    )!

    expect(result.bar.close).toBe(144)
    expect(result.source).toBe('twelvedata')
    const conflict = result.conflicts.find((c) => c.field === 'close')!
    expect(conflict.reason).toBe('HIGHER_TRUST_SOURCE')
    expect(conflict.trustOverride).toBe(false)
  })

  it('falls back to trust when there is no history to judge against', () => {
    const result = reconcileBar(
      [
        sourced('twelvedata', 1, { close: 18 }),
        sourced('tiingo', 2, { close: 180 }),
      ],
      { recentCloses: [] },
    )!

    // Without history the engine has no basis to overrule the ranking, and
    // guessing would be worse than deferring. The disagreement is still
    // recorded, and the bar is still marked unconfirmed.
    expect(result.bar.close).toBe(18)
    expect(result.confirmed).toBe(false)
    expect(result.conflicts[0].reason).toBe('HIGHER_TRUST_SOURCE')
  })

  it('records the decision even when trust wins', () => {
    // Both values are plausible for this instrument, so the ranking decides -
    // and the decision is still written down.
    const result = reconcileBar(
      [sourced('twelvedata', 1, { close: 179 }), sourced('tiingo', 2, { close: 185 })],
      history,
    )!

    const conflict = result.conflicts.find((c) => c.field === 'close')!
    expect(conflict.resolvedValue).toBe(179)
    expect(conflict.reason).toBe('HIGHER_TRUST_SOURCE')
    expect(conflict.trustOverride).toBe(false)
  })

  it('defers to trust when BOTH values are implausible', () => {
    // Neither price fits the history. Picking the less-wrong one would be
    // dressing a guess up as a sanity check; the honest outcome is to keep
    // the ranking's answer and mark the bar unconfirmed.
    const result = reconcileBar(
      [sourced('twelvedata', 1, { close: 20 }), sourced('tiingo', 2, { close: 25 })],
      history,
    )!

    expect(result.bar.close).toBe(20)
    expect(result.confirmed).toBe(false)
    expect(result.conflicts[0].trustOverride).toBe(false)
  })
})

describe('abnormality', () => {
  it('scales by the instrument’s own typical move, not a fixed percentage', () => {
    const calm = { recentCloses: [100, 100.5, 99.8, 100.2, 100.1, 99.9] }
    const wild = { recentCloses: [100, 118, 96, 112, 99, 115] }

    // The same candidate is wildly abnormal for one and unremarkable for the
    // other. A universal 20% band cannot express that.
    const candidate = 120
    expect(abnormality(candidate, calm)!).toBeGreaterThan(
      abnormality(candidate, wild)!,
    )
  })

  it('returns null rather than guessing on thin history', () => {
    expect(abnormality(120, { recentCloses: [100] })).toBeNull()
    expect(abnormality(120, undefined)).toBeNull()
  })
})
