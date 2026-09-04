import type { Bar, DetectorId } from './types'

/**
 * Did the warning precede anything?
 *
 * Of the events that would have been surfaced, how many were followed by a move
 * large enough to matter? This is the closest thing the project has to a measure
 * of whether the engine is right, and it is used in two places that must never
 * disagree: the calibration report, and the per-detector scorecard the product
 * publishes about itself.
 *
 * It is a PROXY, not ground truth. Nobody labelled these events, and "did the
 * user care?" is unmeasurable before the product has users. What it tests is
 * whether an alert carried information about the near future rather than
 * restating noise that had already passed. A rate is only meaningful next to
 * the same measurement over every day (the "look every day" baseline): a
 * detector that fires constantly can score well while saying nothing.
 *
 * Pure: no database, no clock, no network. Lives in the engine so there is one
 * implementation rather than two that could drift.
 */

export const FOLLOW_HORIZON = 3
export const FOLLOW_SIGMA = 1.5

/** Minimum sample before a rate may be shown to anyone. */
export const MIN_SCORECARD_SAMPLE = 30

export interface FollowThrough {
  checked: number
  followed: number
}

/** Anything carrying a market date. Keeps this usable from both call sites. */
interface Dated {
  marketTime: string
}

export function followThroughRate(
  events: Dated[],
  bars: Bar[],
  horizon = FOLLOW_HORIZON,
  sigmaThreshold = FOLLOW_SIGMA,
): FollowThrough {
  const byDate = new Map(bars.map((b, i) => [b.date, i]))
  let checked = 0
  let followed = 0

  for (const e of events) {
    const i = byDate.get(e.marketTime)
    // Events too close to the end of the series have no future to be judged
    // against. Skipped rather than counted as failures.
    if (i === undefined || i + horizon >= bars.length) continue

    const window = bars.slice(Math.max(0, i - 20), i + 1)
    const rets: number[] = []
    for (let k = 1; k < window.length; k++) {
      rets.push(Math.log(window[k].closeAdj / window[k - 1].closeAdj))
    }
    const mean = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length)
    const variance =
      rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1)
    const sigma = Math.sqrt(variance)
    if (!(sigma > 0)) continue

    const forward = Math.log(bars[i + horizon].closeAdj / bars[i].closeAdj)
    checked++
    if (Math.abs(forward) / (sigma * Math.sqrt(horizon)) >= sigmaThreshold) {
      followed++
    }
  }

  return { checked, followed }
}

/** Rate as a fraction, or null when the sample is too small to report. */
export function followThroughShare(f: FollowThrough): number | null {
  if (f.checked < MIN_SCORECARD_SAMPLE) return null
  return f.followed / f.checked
}

/**
 * How much better than looking every day. 1.0 means the detector added nothing
 * over checking the chart daily; below 1.0 means it did worse than that.
 */
export function lift(signal: FollowThrough, baseline: FollowThrough): number | null {
  const s = followThroughShare(signal)
  if (s === null || baseline.checked === 0) return null
  const b = baseline.followed / baseline.checked
  if (!(b > 0)) return null
  return s / b
}

/**
 * Signal key to the detector that emits it.
 *
 * Contributions carry the signal's key, not the detector's id, because the
 * scorer works on merged signals. The relationship is 1:1, so a static map is
 * honest here - but it has to be kept in step with `detectors.ts`, which the
 * exhaustive DetectorId typing below enforces at compile time.
 */
export const SIGNAL_TO_DETECTOR: Record<string, DetectorId> = {
  move_z: 'move_since_last_seen',
  rvol: 'volume_spike',
  sector_residual: 'sector_divergence',
  range_break: 'range_break',
  vol_regime: 'vol_regime_shift',
  earnings_proximity: 'earnings_upcoming',
  correlation_break: 'correlation_break',
  quiet_regime: 'quiet_regime',
}

/** What the UI shows next to a contribution. */
export interface TrackRecord {
  rate: number
  n: number
  lift: number | null
}
