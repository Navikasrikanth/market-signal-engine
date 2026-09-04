import { redirect } from 'next/navigation'
import Link from 'next/link'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  FOLLOW_HORIZON,
  FOLLOW_SIGMA,
  MIN_SCORECARD_SAMPLE,
} from '@/engine/followthrough'

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

  const rows = await db.detectorScorecard.findMany()

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
    <main className="mx-auto w-full max-w-3xl px-5 py-10">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-mono text-[11px] tracking-[0.2em] text-[color:var(--accent-ink)]">
          SITREP · PERFORMANCE
        </span>
        <Link
          href="/"
          className="font-mono text-[10px] tracking-wide text-[color:var(--ink-3)] underline decoration-dotted underline-offset-4 hover:text-[color:var(--accent-ink)]"
        >
          back to brief
        </Link>
      </div>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight">
        Does this thing actually work?
      </h1>

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
          <section className="mt-8 overflow-x-auto rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]">
            <table className="w-full min-w-[42rem] text-sm">
              <thead>
                <tr className="border-b border-[color:var(--border)] text-left font-mono text-[10px] tracking-wider text-[color:var(--ink-3)]">
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
                      className="border-b border-[color:var(--border)] last:border-0"
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

          <section className="mt-8 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
            <h2 className="mb-2 font-mono text-[10px] tracking-wider text-[color:var(--ink-3)]">
              WHAT THIS IS NOT
            </h2>
            <p className="text-xs leading-relaxed text-[color:var(--ink-2)]">
              This is a <strong>proxy</strong>, not ground truth. Nobody
              labelled these events, and &ldquo;did the user care?&rdquo; is
              unmeasurable before the product has users. It tests one thing:
              whether an alert carried information about the near future rather
              than restating noise that had already passed. A rate below{' '}
              {MIN_SCORECARD_SAMPLE} observations is not shown at all — a 100%
              hit rate on three events is not a hit rate.{' '}
              <code>earnings_upcoming</code> is absent because the free data
              tier serves forward-looking dates only, so it cannot be tested
              historically.
            </p>
            {window && (
              <p className="mt-3 font-mono text-[10px] tracking-wide text-[color:var(--ink-3)]">
                engine {window.engineV} ·{' '}
                {window.windowStart.toISOString().slice(0, 10)} to{' '}
                {window.windowEnd.toISOString().slice(0, 10)} · refreshed{' '}
                {window.computedAt.toISOString().slice(0, 16).replace('T', ' ')}
              </p>
            )}
          </section>
        </>
      )}
    </main>
  )
}
