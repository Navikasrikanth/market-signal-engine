import { redirect } from 'next/navigation'
import Link from 'next/link'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { cached, TTL } from '@/lib/cache'
import {
  FOLLOW_HORIZON,
  FOLLOW_SIGMA,
  MIN_SCORECARD_SAMPLE,
} from '@/engine/followthrough'
import { Shell } from '@/components/Shell'
import { Caveat } from '@/components/Caveat'

export const dynamic = 'force-dynamic'

/**
 * Does this thing actually work?
 *
 * The page is only worth having if it can embarrass the engine, so it is built
 * to do that: sorted worst-first, sample size printed next to every rate, and
 * any detector losing to the "look every day" baseline called out rather than
 * averaged away. A product that filters someone's attention should be willing
 * to publish how often it was right.
 *
 * Deliberately NOT wired back into the scorer. Tuning the weights on the metric
 * used to judge them would make the calibration unfalsifiable.
 */
export default async function PerformancePage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  const rows = await cached('scorecard', 'all', TTL.scorecard, () =>
    db.detectorScorecard.findMany(),
  )

  const scored = rows
    .map((r) => {
      const enough = r.checked >= MIN_SCORECARD_SAMPLE
      const rate = enough ? r.followed / r.checked : null
      const base = r.baseChecked > 0 ? r.baseFollowed / r.baseChecked : null
      return {
        ...r,
        rate,
        base,
        lift: rate !== null && base ? rate / base : null,
      }
    })
    // Worst first. A scorecard that leads with its best number is marketing.
    .sort((a, b) => (a.lift ?? Infinity) - (b.lift ?? Infinity))

  const losing = scored.filter((s) => s.lift !== null && s.lift < 1)
  const window = rows[0]

  return (
    <Shell displayName={user.displayName}>
    <main className="mx-auto w-full max-w-3xl px-5 py-10">

      <h1 className="display rise">Does this thing actually work?</h1>

      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[color:var(--ink-2)]">
        Every detector, measured against what happened next. A warning
        &ldquo;followed through&rdquo; when the name moved at least{' '}
        {FOLLOW_SIGMA}σ within {FOLLOW_HORIZON} sessions of the alert. The
        baseline is the same test applied to <em>every</em> trading day, warning
        or not — a detector that fires constantly can score well while saying
        nothing, so the only number that matters is the ratio between them.
      </p>

      {scored.length === 0 ? (
        <p className="mt-8 text-sm text-[color:var(--ink-3)]">
          No scorecard yet. Run <code>npm run compute</code>.
        </p>
      ) : (
        <>
          <LiftChart rows={scored} />

          <section className="card mt-6 overflow-x-auto p-0">
            <table className="w-full min-w-[42rem] border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="glass-strong border-b border-[color:var(--border)] text-left font-mono text-[10px] tracking-wider text-[color:var(--ink-3)]">
                  <th className="p-3 font-normal">DETECTOR</th>
                  <th className="p-3 text-right font-normal">FIRED</th>
                  <th className="p-3 text-right font-normal">SURFACED</th>
                  <th className="p-3 text-right font-normal">FOLLOWED THROUGH</th>
                  <th className="p-3 text-right font-normal">BASELINE</th>
                  <th className="p-3 text-right font-normal">VS BASELINE</th>
                </tr>
              </thead>
              <tbody>
                {scored.map((s) => {
                  const bad = s.lift !== null && s.lift < 1
                  return (
                    <tr
                      key={s.detector}
                      className="border-b border-[color:var(--border)] transition-colors last:border-0 hover:bg-[color:var(--surface-2)]"
                    >
                      <td className="p-3 font-mono text-[13px]">{s.detector}</td>
                      <td className="tabular p-3 text-right text-[color:var(--ink-2)]">
                        {s.fired.toLocaleString()}
                      </td>
                      <td className="tabular p-3 text-right text-[color:var(--ink-2)]">
                        {s.surfaced.toLocaleString()}
                      </td>
                      <td className="tabular p-3 text-right">
                        {s.rate === null ? (
                          <span className="text-[color:var(--ink-3)]">
                            not enough data
                          </span>
                        ) : (
                          <>
                            {(s.rate * 100).toFixed(1)}%{' '}
                            <span className="text-[color:var(--ink-3)]">
                              n={s.checked.toLocaleString()}
                            </span>
                          </>
                        )}
                      </td>
                      <td className="tabular p-3 text-right text-[color:var(--ink-3)]">
                        {s.base === null ? '—' : `${(s.base * 100).toFixed(1)}%`}
                      </td>
                      <td
                        className="tabular p-3 text-right font-medium"
                        style={{
                          color: bad ? 'var(--down)' : 'var(--ink)',
                        }}
                      >
                        {s.lift === null ? '—' : `${s.lift.toFixed(2)}×`}
                        {bad && (
                          <span className="ml-2 font-mono text-[10px] tracking-wider">
                            WORSE THAN CHANCE
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>

          {losing.length > 0 && (
            <p className="mt-4 text-sm leading-relaxed text-[color:var(--ink-2)]">
              <span className="font-mono text-[11px] tracking-wider text-[color:var(--down)]">
                {losing.map((l) => l.detector).join(', ')}
              </span>{' '}
              {losing.length === 1 ? 'does' : 'do'} worse than simply looking
              every day. That is kept on the page rather than quietly dropped:
              it is the clearest evidence the measurement is not being tuned to
              flatter the engine. The honest options are to raise{' '}
              {losing.length === 1 ? 'its threshold' : 'their thresholds'} or
              remove {losing.length === 1 ? 'it' : 'them'} — not to stop
              measuring.
            </p>
          )}

          <Caveat summary="WHAT THIS IS NOT — a proxy, not ground truth">
            Nobody labelled these events, and &ldquo;did the user care?&rdquo;
            is unmeasurable before the product has users. This tests one thing:
            whether an alert carried information about the near future rather
            than restating noise that had already passed. A rate below{' '}
            {MIN_SCORECARD_SAMPLE} observations is not shown at all — a 100%
            hit rate on three events is not a hit rate.{' '}
            <code>earnings_upcoming</code> is absent because the free data tier
            serves forward-looking dates only, so it cannot be tested
            historically.
            {window && (
              <span className="mt-2 block font-mono text-[10px] tracking-wide">
                engine {window.engineV} ·{' '}
                {window.windowStart.toISOString().slice(0, 10)} to{' '}
                {window.windowEnd.toISOString().slice(0, 10)} · refreshed{' '}
                {window.computedAt.toISOString().slice(0, 16).replace('T', ' ')}
              </span>
            )}
          </Caveat>
        </>
      )}
    </main>
    </Shell>
  )
}

/**
 * Lift, as bars against the baseline.
 *
 * The table has every number; this has the one comparison that decides
 * anything. A detector is worth having only if it beats simply looking every
 * day, so the baseline is drawn as a line at 1.00× and each bar is measured
 * from it — a bar that fails to reach the line is a detector that is not
 * earning its place, and that should be visible before any column is read.
 *
 * Bars are widths, not transforms, and are painted once on the server. There
 * is no animation here: a bar growing into place invites the reader to watch
 * it rather than read it, and this page exists to be read sceptically.
 */
function LiftChart({
  rows,
}: {
  rows: Array<{ detector: string; lift: number | null }>
}) {
  const measurable = rows.filter(
    (r): r is { detector: string; lift: number } => r.lift !== null,
  )
  if (measurable.length === 0) return null

  // The axis runs to the largest bar or to 2×, whichever is greater, so the
  // baseline line never sits at the very edge of the chart where it cannot be
  // compared against anything.
  const max = Math.max(2, ...measurable.map((r) => r.lift))
  const baselineAt = (1 / max) * 100

  return (
    <section
      aria-label="Detector lift against baseline"
      className="card mt-8 p-4"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="meta">LIFT VS BASELINE</p>
        <p className="text-[11px] text-[color:var(--ink-3)]">
          the line is 1.00× — no better than looking every day
        </p>
      </div>

      {/*
        Flex rows, with the baseline drawn inside each bar's own track.
        Spanning one line across a grid meant giving it a cell, and that cell
        pushed the first row's bar out of alignment with its label - the chart
        rendered with every bar one row below the detector it belonged to.
        Repeating the marker per track cannot desynchronise from the bars,
        because it is measured in the same box they are.
      */}
      <div className="flex flex-col gap-2">
        {measurable.map((r, i) => {
          const bad = r.lift < 1
          return (
            <div key={r.detector} className="flex items-center gap-3">
              <span className="w-44 shrink-0 truncate font-mono text-[11px] text-[color:var(--ink-2)]">
                {r.detector}
              </span>
              <span className="relative h-3 flex-1 rounded-full bg-[color:var(--surface-2)]">
                {/*
                  Grown from the left with a scale, not a width.
                  
                  Animating `width` would relayout the row on every frame; a
                  scaleX is composited. The bar is drawn at full length and
                  squashed to nothing, so the browser lays it out exactly once.
                */}
                <span
                  className="grow-bar absolute inset-y-0 left-0 origin-left rounded-full"
                  style={{
                    width: `${(r.lift / max) * 100}%`,
                    background: bad ? 'var(--down)' : 'var(--accent)',
                    opacity: bad ? 0.85 : 0.75,
                    animationDelay: `${i * 60}ms`,
                  }}
                />
                {/* 1.00x. Drawn over the bar so a detector that fails to reach
                    it is unmistakable rather than a matter of measuring. */}
                <span
                  aria-hidden
                  className="absolute -inset-y-1 w-px"
                  style={{
                    left: `${baselineAt}%`,
                    background: 'var(--ink-2)',
                    opacity: 0.55,
                  }}
                />
              </span>
              <span
                className="num w-14 shrink-0 text-right text-xs font-medium"
                style={{ color: bad ? 'var(--down)' : 'var(--ink-2)' }}
              >
                {r.lift.toFixed(2)}×
              </span>
            </div>
          )
        })}
      </div>

    </section>
  )
}
