import type { RawBar } from '../sources/types'

/**
 * Cross-source reconciliation.
 *
 * Two providers describing the same session will not always agree. Silently
 * picking one and showing it as fact is the failure this module exists to
 * prevent: a watchlist that quietly renders a disputed price as though it were
 * settled is worse than one that admits it does not know.
 *
 * Policy, in short:
 *   - agree within tolerance  -> take the higher-trust value, fully confirmed
 *   - disagree beyond it      -> keep both, mark UNCONFIRMED, record the conflict
 *   - only one source has it  -> use it, slightly reduced confidence, no conflict
 *
 * The `confirmed` flag and reduced `confidence` both flow downstream: the scorer
 * multiplies by confidence and hard-caps severity for unconfirmed bars, and the
 * UI renders an amber badge. A disputed price can never produce a CRITICAL.
 */

export interface SourcedBar {
  sourceId: string
  trustRank: number
  bar: RawBar
}

export interface FieldConflict {
  field: 'close' | 'open' | 'high' | 'low' | 'volume'
  sourceA: string
  valueA: number
  sourceB: string
  valueB: number
  deltaPct: number
  resolvedTo: string
  /** The value actually stored, so the decision needs no re-derivation. */
  resolvedValue: number
  /** Why this value won. */
  reason: ResolutionReason
  /** True when sanity beat trust — the higher-ranked provider was overruled. */
  trustOverride: boolean
}

/**
 * Why a disagreement resolved the way it did.
 *
 * Stored per conflict. A resolution that cannot be audited is indistinguishable
 * from a guess, and this product's whole claim is that its numbers can be
 * traced back to a decision.
 */
export type ResolutionReason =
  | 'HIGHER_TRUST_SOURCE'
  | 'PRIMARY_VALUE_FAILED_HISTORY_SANITY'
  | 'ONLY_SOURCE'

export const RECONCILIATION_VERSION = 'RECONCILIATION_V2'

export interface ReconciledBar {
  bar: RawBar
  source: string
  /** 0..1. Feeds the scorer's data-quality multiplier. */
  confidence: number
  /** False only when trusted sources actively disagree on a PRICE field. */
  confirmed: boolean
  conflicts: FieldConflict[]
  contributingSources: string[]
}

/**
 * Tolerances, per field family.
 *
 * Prices are tight: legitimate providers should agree on a daily close to well
 * within a third of a percent, so a wider gap is a genuine data problem.
 *
 * Volume is deliberately loose. Providers routinely differ by double digits on
 * daily share volume because some report consolidated tape and others only the
 * primary listing. Holding volume to a price-like tolerance would flag almost
 * every bar and train everyone to ignore the badge — the exact alert-fatigue
 * failure this product is built to avoid.
 */
export const TOLERANCE = {
  price: 0.003,
  volume: 0.25,
} as const

/**
 * Volume disagreement is RECORDED but does not mark a bar unconfirmed.
 *
 * A consolidated-vs-primary volume difference is a known accounting difference
 * between vendors, not evidence that the session is in doubt. Letting it set
 * `confirmed = false` would suppress severity on perfectly good data.
 */
const UNCONFIRMING_FIELDS = new Set(['close', 'open', 'high', 'low'])

function relativeDelta(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b))
  if (denom === 0) return 0
  return Math.abs(a - b) / denom
}

/**
 * Recent closes for the instrument, used to judge which of two disagreeing
 * values is the plausible one. Optional: with no history, trust decides.
 */
export interface PriceHistory {
  /** Most recent closes, any order. A handful is enough. */
  recentCloses: number[]
}

/**
 * How abnormal a candidate price is, in multiples of the instrument's own
 * typical move. `null` when there is not enough history to judge.
 *
 * Deliberately NOT a fixed percentage band. A flat 20% rule is wrong in both
 * directions: it rejects a legitimate 25% move in a name that routinely moves
 * 15%, and it accepts a corrupt value in a name that never moves 3%. What
 * matters is how the candidate sits against THIS instrument's own behaviour.
 */
export function abnormality(
  candidate: number,
  history: PriceHistory | undefined,
): number | null {
  const closes = history?.recentCloses.filter((c) => Number.isFinite(c) && c > 0)
  if (!closes || closes.length < 3) return null

  const sorted = [...closes].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  if (!(median > 0)) return null

  // Typical single-session move, from the history itself. Floored so a
  // pathologically flat series cannot make every value look infinitely
  // abnormal.
  const moves: number[] = []
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]
    if (prev > 0) moves.push(Math.abs(closes[i] / prev - 1))
  }
  const typical = Math.max(
    0.01,
    moves.length ? moves.reduce((a, b) => a + b, 0) / moves.length : 0.01,
  )

  return Math.abs(candidate / median - 1) / typical
}

/**
 * Beyond this many typical moves, a value is treated as corrupt rather than
 * dramatic — even when it comes from the more trusted provider.
 *
 * Ten typical moves is a long way. A name that usually moves 2% would have to
 * print 20% off its recent median; the decimal-shift case (a $180 stock
 * printing $18) lands at roughly 45.
 */
const ABNORMAL_LIMIT = 10

/**
 * Reconcile one calendar date across however many sources supplied it.
 *
 * Returns `null` when no source has the bar at all — the caller records that as
 * a gap rather than inventing a value.
 */
export function reconcileBar(
  candidates: SourcedBar[],
  history?: PriceHistory,
): ReconciledBar | null {
  if (candidates.length === 0) return null

  // Lower trustRank wins. Stable sort keeps behaviour deterministic when two
  // sources share a rank.
  const ranked = [...candidates].sort((a, b) => a.trustRank - b.trustRank)
  const primary = ranked[0]

  if (ranked.length === 1) {
    return {
      bar: primary.bar,
      source: primary.sourceId,
      // Not disputed, but not corroborated either. A single source is worth
      // slightly less than two that agree, and the score should reflect that.
      confidence: 0.9,
      confirmed: true,
      conflicts: [],
      contributingSources: [primary.sourceId],
    }
  }

  const conflicts: FieldConflict[] = []
  const fields: FieldConflict['field'][] = ['open', 'high', 'low', 'close', 'volume']
  /** Fields where sanity overruled trust, applied to the stored bar below. */
  const overrides = new Map<FieldConflict['field'], number>()

  for (const other of ranked.slice(1)) {
    for (const field of fields) {
      const a = primary.bar[field]
      const b = other.bar[field]
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue

      const delta = relativeDelta(a, b)
      const tolerance = field === 'volume' ? TOLERANCE.volume : TOLERANCE.price

      if (delta <= tolerance) continue

      // Sanity can beat trust.
      //
      // Resolution used to be `resolvedTo: primary.sourceId`, unconditionally.
      // That meant a corrupt $18 from the higher-trust provider beat a correct
      // $180 from the other one - the trust ranking decided, and the ranking
      // has no idea whether a number is possible.
      let resolvedTo = primary.sourceId
      let resolvedValue = a
      let reason: ResolutionReason = 'HIGHER_TRUST_SOURCE'
      let trustOverride = false

      if (field !== 'volume') {
        const primaryAbnormality = abnormality(a, history)
        const otherAbnormality = abnormality(b, history)

        // Override only when the trusted value is IMPOSSIBLE and the
        // alternative is PLAUSIBLE. Requiring merely "less abnormal" is not
        // enough: when both values are implausible - stale history, or a
        // genuine gap the history cannot anticipate - that rule picks the
        // marginally-less-wrong one and calls it a sanity check. Deferring to
        // trust and flagging the bar unconfirmed is the honest answer there.
        if (
          primaryAbnormality !== null &&
          otherAbnormality !== null &&
          primaryAbnormality > ABNORMAL_LIMIT &&
          otherAbnormality <= ABNORMAL_LIMIT
        ) {
          resolvedTo = other.sourceId
          resolvedValue = b
          reason = 'PRIMARY_VALUE_FAILED_HISTORY_SANITY'
          trustOverride = true
          overrides.set(field, b)
        }
      }

      conflicts.push({
        field,
        sourceA: primary.sourceId,
        valueA: a,
        sourceB: other.sourceId,
        valueB: b,
        deltaPct: delta,
        resolvedTo,
        resolvedValue,
        reason,
        trustOverride,
      })
    }
  }

  const priceConflicts = conflicts.filter((c) => UNCONFIRMING_FIELDS.has(c.field))
  const confirmed = priceConflicts.length === 0

  // Apply any overridden fields to the bar that is actually stored. Recording
  // the decision but persisting the rejected value would be worse than not
  // deciding at all.
  const bar = overrides.size
    ? { ...primary.bar, ...Object.fromEntries(overrides) }
    : primary.bar

  return {
    bar,
    source: overrides.size ? ranked[1].sourceId : primary.sourceId,
    confidence: confidenceFor(priceConflicts),
    confirmed,
    conflicts,
    contributingSources: ranked.map((r) => r.sourceId),
  }
}

/**
 * Confidence degrades with the size of the worst price disagreement, floored at
 * 0.5 so a disputed bar still contributes something rather than vanishing.
 *
 * A 0.5% disagreement is a nuisance; a 20% disagreement means one provider is
 * plainly wrong and nothing derived from that bar should be trusted much.
 */
function confidenceFor(priceConflicts: FieldConflict[]): number {
  if (priceConflicts.length === 0) return 1

  const worst = Math.max(...priceConflicts.map((c) => c.deltaPct))
  // Linear from 1.0 at the tolerance boundary down to 0.5 at a 10% gap.
  const scaled = 1 - (worst - TOLERANCE.price) / (0.1 - TOLERANCE.price) / 2
  return Math.min(1, Math.max(0.5, Number(scaled.toFixed(3))))
}

export interface ReconcileSeriesResult {
  bars: ReconciledBar[]
  conflicts: Array<FieldConflict & { date: string }>
  /** Dates present in a secondary source but missing from the primary. */
  gapsFilled: string[]
}

/**
 * Reconcile whole series, joined on market date.
 *
 * Joined by DATE, never by position. Providers differ on holiday handling, so
 * positional pairing would silently offset one series against the other and
 * corrupt every downstream return.
 */
export function reconcileSeries(
  series: Array<{ sourceId: string; trustRank: number; bars: RawBar[] }>,
): ReconcileSeriesResult {
  const byDate = new Map<string, SourcedBar[]>()
  const primaryRank = Math.min(...series.map((s) => s.trustRank))
  const primaryDates = new Set<string>()

  for (const s of series) {
    for (const bar of s.bars) {
      const list = byDate.get(bar.date) ?? []
      list.push({ sourceId: s.sourceId, trustRank: s.trustRank, bar })
      byDate.set(bar.date, list)
      if (s.trustRank === primaryRank) primaryDates.add(bar.date)
    }
  }

  const bars: ReconciledBar[] = []
  const conflicts: Array<FieldConflict & { date: string }> = []
  const gapsFilled: string[] = []

  // Rolling recent closes, built as we go, so each date is judged against the
  // sessions BEFORE it. Using the whole series would let a corrupt value help
  // decide whether it was itself plausible.
  const recentCloses: number[] = []
  const HISTORY_WINDOW = 10

  for (const date of [...byDate.keys()].sort()) {
    const reconciled = reconcileBar(byDate.get(date)!, {
      recentCloses: [...recentCloses],
    })
    if (!reconciled) continue

    recentCloses.push(reconciled.bar.close)
    if (recentCloses.length > HISTORY_WINDOW) recentCloses.shift()

    bars.push(reconciled)
    for (const c of reconciled.conflicts) conflicts.push({ ...c, date })

    // A session the primary missed but a secondary has is a filled gap, not a
    // conflict — worth recording so freshness reporting can show it.
    if (!primaryDates.has(date)) gapsFilled.push(date)
  }

  return { bars, conflicts, gapsFilled }
}
