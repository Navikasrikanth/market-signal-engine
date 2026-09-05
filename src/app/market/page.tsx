import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { buildSitrep } from '@/lib/sitrep'
import { Shell } from '@/components/Shell'
import { SeverityChip, Change, Sparkline } from '@/components/primitives'
import { Caveat } from '@/components/Caveat'

export const dynamic = 'force-dynamic'

/**
 * Everything, with no opinion applied.
 *
 * The brief exists to filter, and filtering is the product's argument — but a
 * filter you cannot see past is a filter you have to trust blindly. This is
 * the same market, same scores, same ranking, with the attention budget
 * removed: every name that produced anything, in order, plus an honest count
 * of the ones that produced nothing.
 *
 * It is deliberately a table rather than cards. Cards are for the handful of
 * things that deserve reading; a list of everything is for scanning.
 */
export default async function MarketPage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  const sitrep = await buildSitrep(user.id)
  const quiet = sitrep.watchlistSize - sitrep.all.length - sitrep.snoozedCount

  return (
    <Shell displayName={sitrep.displayName} asOf={sitrep.asOf}>
    <main className="mx-auto w-full max-w-6xl px-5 py-10">

      <h1 className="display rise">Everything at once</h1>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-[color:var(--ink-3)]">
        The same engine, with the attention budget switched off. Your brief
        shows {sitrep.attentionBudget}; this shows all {sitrep.all.length} names
        that produced a signal, in the order the scorer put them.{' '}
        {quiet > 0 && (
          <>
            The remaining {quiet} moved within their normal range and produced
            nothing to rank.
          </>
        )}
      </p>

      {sitrep.all.length === 0 ? (
        <p className="mt-8 text-sm text-[color:var(--ink-3)]">
          Nothing scored above noise across your watchlist.
        </p>
      ) : (
        /* The table is the page here, so it gets the width. A sticky header
           keeps the columns named on a long watchlist - scrolling past the
           header turns "68" into a number with no unit. */
        <section className="card mt-6 overflow-x-auto overflow-y-visible p-0">
          <table className="w-full min-w-[46rem] border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="glass-strong border-b border-[color:var(--border)] text-left font-mono text-[10px] tracking-wider text-[color:var(--ink-3)]">
                <th className="p-3 font-normal">#</th>
                <th className="p-3 font-normal">NAME</th>
                <th className="p-3 text-right font-normal">ATTENTION</th>
                <th className="p-3 font-normal">SEVERITY</th>
                <th className="p-3 text-right font-normal">SINCE YOU LOOKED</th>
                <th className="p-3 font-normal">20 SESSIONS</th>
                <th className="p-3 font-normal">WHAT HAPPENED</th>
              </tr>
            </thead>
            <tbody>
              {sitrep.all.map((item) => {
                const inBrief = item.rank <= sitrep.attentionBudget
                return (
                  <tr
                    key={item.symbol}
                    className="border-b border-[color:var(--border)] transition-colors last:border-0 hover:bg-[color:var(--surface-2)]"
                    // The ones the brief showed are marked, so the boundary the
                    // budget draws is visible rather than implied.
                    style={inBrief ? undefined : { opacity: 0.62 }}
                  >
                    <td className="tabular relative p-3 pl-4 font-mono text-xs text-[color:var(--ink-3)]">
                      {/* Severity as a leading rail, so the column of colour
                          down the left edge is readable before any cell is. */}
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 w-[2px]"
                        style={{
                          background: `var(--sev-${item.severity.toLowerCase()})`,
                        }}
                      />
                      {item.rank}
                    </td>
                    <td className="p-3">
                      <span className="font-mono text-[13px] font-semibold">
                        {item.symbol}
                      </span>
                      <span className="ml-2 text-xs text-[color:var(--ink-3)]">
                        {item.sector ?? ''}
                      </span>
                    </td>
                    <td className="tabular p-3 text-right font-medium">
                      {item.attentionScore}
                    </td>
                    <td className="p-3">
                      <SeverityChip severity={item.severity} />
                    </td>
                    <td className="tabular p-3 text-right">
                      <Change pct={item.windowReturnPct} />
                    </td>
                    <td className="p-3">
                      {/* No draw-in here. Twenty lines animating at once is a
                          page that flickers, not a page that arrives. */}
                      <Sparkline points={item.sparkline} animate={false} />
                    </td>
                    <td className="p-3 text-xs leading-snug text-[color:var(--ink-2)]">
                      {item.headline}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}

      <Caveat summary={`Dimmed rows are the ${Math.max(0, sitrep.all.length - sitrep.attentionBudget)} your brief held back`}>
        Nothing on this page is extra analysis — it is the same scores your
        brief used, shown without the cut. A filter you cannot see past is one
        you have to trust blindly.
      </Caveat>
    </main>
    </Shell>
  )
}
