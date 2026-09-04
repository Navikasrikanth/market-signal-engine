import { describe, expect, it } from 'vitest'
import {
  detectEarningsUpcoming,
  detectMoveSinceLastSeen,
  detectRangeBreak,
  detectCorrelationBreak,
  detectQuietRegime,
  detectSectorDivergence,
  detectVolRegimeShift,
  detectVolumeSpike,
  runDetectors,
  THRESHOLDS,
} from '../detectors'
import type { DetectorInput } from '../detectors'
import { computeFeatures } from '../features'
import type { Bar } from '../types'
import {
  makeCorrelatedSeries,
  makeFlatSeries,
  makeSeries,
} from '../testing/synthetic'

/**
 * Every detector is asserted in BOTH directions: a series that must fire it and
 * a series that must not. A detector that only ever fires is indistinguishable
 * from a detector that is broken, and on a product whose entire promise is "we
 * filter noise", false positives are the expensive failure.
 */

function inputFor(
  bars: Bar[],
  opts: Partial<DetectorInput> & { sector?: Bar[]; benchmark?: Bar[] } = {},
): DetectorInput {
  const { sector = [], benchmark = [], ...rest } = opts
  const features = computeFeatures('TEST', bars, benchmark, sector)
  if (!features) throw new Error('fixture too short to build features')
  return {
    symbol: 'TEST',
    features,
    bars,
    sessionsSinceLastSeen: null,
    nextEarnings: null,
    asOf: bars[bars.length - 1].date,
    ...rest,
  }
}

describe('detectMoveSinceLastSeen', () => {
  it('fires on a large move relative to the absence window', () => {
    const bars = makeSeries({
      days: 200,
      seed: 101,
      dailyVol: 0.01,
      inject: { kind: 'gap', sigmas: 4 },
    })
    const event = detectMoveSinceLastSeen(
      inputFor(bars, { sessionsSinceLastSeen: 1 }),
    )

    expect(event).not.toBeNull()
    expect(event!.detector).toBe('move_since_last_seen')
    expect(event!.direction).toBe(1)
    expect(event!.magnitude).toBeGreaterThan(THRESHOLDS.moveSigmas)
    expect(event!.headline).toMatch(/since you last checked/)
  })

  it('does NOT fire on an ordinary session', () => {
    const bars = makeSeries({ days: 200, seed: 102, dailyVol: 0.01 })
    expect(
      detectMoveSinceLastSeen(inputFor(bars, { sessionsSinceLastSeen: 1 })),
    ).toBeNull()
  })

  it('stays silent when the user has no cursor yet', () => {
    // A first visit has no "since" to measure against. Inventing one would
    // greet every new user with alarms about moves they never missed.
    const bars = makeSeries({
      days: 200,
      seed: 103,
      inject: { kind: 'gap', sigmas: 5 },
    })
    expect(
      detectMoveSinceLastSeen(inputFor(bars, { sessionsSinceLastSeen: null })),
    ).toBeNull()
  })

  it('scales by horizon: a slow drift fires over a long absence, not a short one', () => {
    // 1.2%/day for 10 days is a big cumulative move but an unremarkable day.
    const bars = makeSeries({
      days: 200,
      seed: 104,
      dailyVol: 0.01,
      inject: { kind: 'drift', dailyPct: -0.012, days: 10 },
    })

    const overOneDay = detectMoveSinceLastSeen(
      inputFor(bars, { sessionsSinceLastSeen: 1 }),
    )
    const overTenDays = detectMoveSinceLastSeen(
      inputFor(bars, { sessionsSinceLastSeen: 10 }),
    )

    expect(overTenDays).not.toBeNull()
    expect(overTenDays!.direction).toBe(-1)
    // The same tape produces a different answer depending on how long you were
    // away — which is the entire point of the cursor.
    expect(overTenDays!.magnitude).toBeGreaterThan(overOneDay?.magnitude ?? 0)
  })
})

describe('detectVolumeSpike', () => {
  it('fires when volume is far above its own normal', () => {
    const bars = makeSeries({
      days: 200,
      seed: 111,
      inject: { kind: 'volumeSpike', times: 5 },
    })
    const event = detectVolumeSpike(inputFor(bars))

    expect(event).not.toBeNull()
    expect(event!.magnitude).toBeGreaterThanOrEqual(THRESHOLDS.rvol)
    expect(event!.headline).toMatch(/Volume is .+× its normal level/)
  })

  it('does NOT fire on ordinary volume', () => {
    const bars = makeSeries({ days: 200, seed: 112 })
    expect(detectVolumeSpike(inputFor(bars))).toBeNull()
  })
})

describe('detectCorrelationBreak', () => {
  /** Tracks its sector closely, then decouples over the final 20 sessions. */
  function decoupling(base: Bar[], tail = 20) {
    return makeCorrelatedSeries(
      base,
      (i) => (i < base.length - tail ? 0.95 : 0.0),
      { seed: 31 },
    )
  }

  it('fires when a name stops tracking its sector', () => {
    const bars = makeSeries({ days: 260, seed: 601, dailyVol: 0.012 })
    const event = detectCorrelationBreak(
      inputFor(bars, { sector: decoupling(bars) }),
    )

    expect(event).not.toBeNull()
    expect(event!.magnitude).toBeGreaterThanOrEqual(THRESHOLDS.corrBreakDrop)
    expect(event!.headline).toMatch(/Stopped tracking its sector/)
    // Decoupling is neither bullish nor bearish. It is a claim about structure.
    expect(event!.direction).toBe(0)
  })

  it('does NOT fire when the relationship holds', () => {
    const bars = makeSeries({ days: 260, seed: 602, dailyVol: 0.012 })
    const stable = makeCorrelatedSeries(bars, 0.95, { seed: 32 })

    expect(detectCorrelationBreak(inputFor(bars, { sector: stable }))).toBeNull()
  })

  it('does NOT fire on a pair that never correlated', () => {
    // The gate that matters most. Without a baseline requirement, every
    // unrelated pair "breaks" constantly, because short-window correlation of
    // two independent series wanders freely around zero.
    const bars = makeSeries({ days: 260, seed: 603, dailyVol: 0.012 })
    const unrelated = makeCorrelatedSeries(bars, 0.0, { seed: 33 })

    const f = computeFeatures('TEST', bars, [], unrelated)!
    expect(f.corrSectorLong!).toBeLessThan(THRESHOLDS.corrBreakBaseline)
    expect(detectCorrelationBreak(inputFor(bars, { sector: unrelated }))).toBeNull()
  })

  it('returns null rather than a confident zero when history is too short', () => {
    const bars = makeSeries({ days: 90, seed: 604 })
    const sector = makeCorrelatedSeries(bars, 0.95, { seed: 34 })

    // 90 sessions cannot support a 120-session baseline.
    const f = computeFeatures('TEST', bars, [], sector)!
    expect(f.corrSectorLong).toBeNull()
    expect(detectCorrelationBreak(inputFor(bars, { sector }))).toBeNull()
  })

  it('is unaffected by a session the sector series is missing', () => {
    // Positional pairing across a holiday one series observes and the other
    // does not would offset every subsequent return by a day. For a detector
    // whose whole job is noticing a relationship change, that artefact is
    // indistinguishable from the signal itself.
    const bars = makeSeries({ days: 260, seed: 605, dailyVol: 0.012 })
    const sector = makeCorrelatedSeries(bars, 0.95, { seed: 35 })

    const withHoliday = sector.filter((_, i) => i !== 100)

    const full = computeFeatures('TEST', bars, [], sector)!
    const gapped = computeFeatures('TEST', bars, [], withHoliday)!

    // Not identical - one fewer observation - but the same relationship.
    expect(Math.abs(full.corrSectorLong! - gapped.corrSectorLong!)).toBeLessThan(0.1)
    expect(detectCorrelationBreak(inputFor(bars, { sector: withHoliday }))).toBeNull()
  })
})

describe('detectQuietRegime', () => {
  it('fires when a name goes unusually still', () => {
    // An active year, then a compressed tail: quiet BOTH against its own
    // history and against its recent self.
    const bars = makeSeries({
      days: 300,
      seed: 701,
      dailyVol: 0.02,
      inject: { kind: 'volRegime', times: 0.15, days: 25 },
    })

    const event = detectQuietRegime(inputFor(bars))

    expect(event).not.toBeNull()
    expect(event!.direction).toBe(0)
    expect(event!.headline).toMatch(/Unusually still/)
  })

  it('does NOT fire on a name that is always quiet', () => {
    // The distinction the product depends on: this detector reports a name
    // that HAS GONE quiet, not one that simply is quiet. A permanently sleepy
    // name would otherwise republish the same non-news every session.
    const bars = makeSeries({ days: 300, seed: 702, dailyVol: 0.004 })

    expect(detectQuietRegime(inputFor(bars))).toBeNull()
  })

  it('does NOT fire on an ordinary active name', () => {
    const bars = makeSeries({ days: 300, seed: 703, dailyVol: 0.018 })

    expect(detectQuietRegime(inputFor(bars))).toBeNull()
  })

  it('does NOT fire while volatility is expanding', () => {
    const bars = makeSeries({
      days: 300,
      seed: 704,
      dailyVol: 0.01,
      inject: { kind: 'volRegime', times: 3, days: 25 },
    })

    expect(detectQuietRegime(inputFor(bars))).toBeNull()
  })

  it('returns null rather than guessing when history is too short', () => {
    const bars = makeSeries({ days: 62, seed: 705, dailyVol: 0.02 })
    const f = computeFeatures('TEST', bars, [], [])!

    expect(f.rv10Pct).toBeNull()
    expect(detectQuietRegime(inputFor(bars))).toBeNull()
  })
})

describe('detectSectorDivergence', () => {
  it('fires when the name moves and its sector does not', () => {
    const bars = makeSeries({
      days: 250,
      seed: 121,
      dailyVol: 0.012,
      inject: { kind: 'gap', sigmas: 5 },
    })
    const quietSector = makeFlatSeries(bars)

    const event = detectSectorDivergence(inputFor(bars, { sector: quietSector }))

    expect(event).not.toBeNull()
    expect(event!.magnitude).toBeGreaterThan(THRESHOLDS.sectorDivergenceZ)
    expect(event!.headline).toMatch(/against its sector/)
  })

  it('does NOT fire when the whole sector moves together', () => {
    // This is the case that separates company news from sector weather, and the
    // one a naive "% change" watchlist gets wrong every time.
    const bars = makeSeries({ days: 250, seed: 122, dailyVol: 0.012 })
    const movingSector = makeCorrelatedSeries(bars, 0.99, {
      seed: 123,
      dailyVol: 0.001,
    })

    expect(
      detectSectorDivergence(inputFor(bars, { sector: movingSector })),
    ).toBeNull()
  })

  it('stays silent when no sector proxy is available', () => {
    const bars = makeSeries({ days: 200, seed: 124 })
    expect(detectSectorDivergence(inputFor(bars))).toBeNull()
  })
})

describe('detectRangeBreak', () => {
  it('fires on a decisive break beyond the recent range', () => {
    const bars = makeSeries({
      days: 200,
      seed: 131,
      inject: { kind: 'rangeBreak', atrMultiple: 3, direction: 1 },
    })
    const event = detectRangeBreak(inputFor(bars))

    expect(event).not.toBeNull()
    expect(event!.direction).toBe(1)
    expect(event!.magnitude).toBeGreaterThan(THRESHOLDS.rangeBreakAtr)
    expect(event!.headline).toMatch(/Broke above/)
  })

  it('fires downward too', () => {
    const bars = makeSeries({
      days: 200,
      seed: 132,
      inject: { kind: 'rangeBreak', atrMultiple: 3, direction: -1 },
    })
    const event = detectRangeBreak(inputFor(bars))
    expect(event).not.toBeNull()
    expect(event!.direction).toBe(-1)
    expect(event!.headline).toMatch(/Broke below/)
  })

  it('does NOT fire for a close inside the range', () => {
    const bars = makeSeries({ days: 200, seed: 133 })
    expect(detectRangeBreak(inputFor(bars))).toBeNull()
  })
})

describe('detectVolRegimeShift', () => {
  it('fires when short-horizon volatility jumps above long-horizon', () => {
    const bars = makeSeries({
      days: 250,
      seed: 141,
      dailyVol: 0.008,
      inject: { kind: 'volRegime', times: 4, days: 10 },
    })
    const event = detectVolRegimeShift(inputFor(bars))

    expect(event).not.toBeNull()
    expect(event!.magnitude).toBeGreaterThan(THRESHOLDS.volRegimeRatio)
    expect(event!.direction).toBe(0)
  })

  it('does NOT fire in a stable volatility regime', () => {
    const bars = makeSeries({ days: 250, seed: 142, dailyVol: 0.008 })
    expect(detectVolRegimeShift(inputFor(bars))).toBeNull()
  })
})

describe('detectEarningsUpcoming', () => {
  const bars = makeSeries({ days: 200, seed: 151, startDate: '2024-01-01' })
  const asOf = bars[bars.length - 1].date

  function plusDays(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
  }

  it('fires for a report inside the window', () => {
    const event = detectEarningsUpcoming(
      inputFor(bars, {
        asOf,
        nextEarnings: { date: plusDays(asOf, 1), session: 'amc' },
      }),
    )
    expect(event).not.toBeNull()
    expect(event!.headline).toMatch(/Reports earnings/)
    expect(event!.headline).toMatch(/after the close/)
  })

  it('does NOT fire for a report well outside the window', () => {
    expect(
      detectEarningsUpcoming(
        inputFor(bars, {
          asOf,
          nextEarnings: { date: plusDays(asOf, 9), session: 'amc' },
        }),
      ),
    ).toBeNull()
  })

  it('does NOT fire for a report already in the past', () => {
    expect(
      detectEarningsUpcoming(
        inputFor(bars, {
          asOf,
          nextEarnings: { date: plusDays(asOf, -3), session: 'amc' },
        }),
      ),
    ).toBeNull()
  })

  it('stays silent with no known earnings date', () => {
    expect(
      detectEarningsUpcoming(inputFor(bars, { asOf, nextEarnings: null })),
    ).toBeNull()
  })

  it('weights a nearer report more heavily than a distant one', () => {
    const soon = detectEarningsUpcoming(
      inputFor(bars, {
        asOf,
        nextEarnings: { date: plusDays(asOf, 1), session: 'bmo' },
      }),
    )!
    // Both must sit inside the 48h window; an "amc" report two days out is
    // 53 hours away and correctly falls outside it.
    const later = detectEarningsUpcoming(
      inputFor(bars, {
        asOf,
        nextEarnings: { date: plusDays(asOf, 2), session: 'bmo' },
      }),
    )!
    expect(later).not.toBeNull()
    expect(soon.magnitude).toBeGreaterThan(later.magnitude)
  })
})

describe('runDetectors', () => {
  it('returns nothing on a calm, unremarkable series', () => {
    // The quiet case has to work. A product that claims to filter noise but
    // finds something every day has not filtered anything.
    const bars = makeSeries({ days: 250, seed: 161, dailyVol: 0.01 })
    const sector = makeCorrelatedSeries(bars, 0.9, { seed: 162 })

    const events = runDetectors(
      inputFor(bars, { sector, sessionsSinceLastSeen: 1 }),
    )
    expect(events).toEqual([])
  })

  it('can surface several independent findings at once', () => {
    const bars = makeSeries({
      days: 250,
      seed: 163,
      dailyVol: 0.01,
      inject: { kind: 'gap', sigmas: 5 },
    })
    // Add a volume spike on the same bar as the gap.
    const withVolume = [...bars]
    const lastIdx = withVolume.length - 1
    withVolume[lastIdx] = {
      ...withVolume[lastIdx],
      volume: withVolume[lastIdx].volume * 8,
    }

    const events = runDetectors(
      inputFor(withVolume, {
        sector: makeFlatSeries(withVolume),
        sessionsSinceLastSeen: 1,
      }),
    )

    const kinds = events.map((e) => e.detector)
    expect(kinds).toContain('move_since_last_seen')
    expect(kinds).toContain('volume_spike')
    expect(kinds).toContain('sector_divergence')
  })
})
