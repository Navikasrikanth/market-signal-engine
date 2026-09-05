import type { MarketPulse as Pulse } from '@/lib/sitrep'
import { Sparkline } from './primitives'

/**
 * What the market did, over the same window as everything else on the page.
 *
 * This answers the question a brief otherwise leaves hanging. Being told a
 * name fell 6% is not information on its own — the reader needs to know
 * whether that was the name or was the whole market, and until now the only
 * place that comparison existed was inside one sentence of the narrative.
 *
 * The benchmark leads because it is the one every card is measured against.
 * The sector proxies follow because they are what the relative-performance
 * detector regresses each name onto: if a card says a name diverged from its
 * sector, the sector it diverged from is on this strip.
 *
 * Nothing here is decorative and nothing here is new data — every row is an
 * ETF already ingested, and every number comes from the same `windowStats`
 * that produced the numbers on the cards.
 */
export function MarketPulse({
  market,
  since,
}: {
  market: Pulse
  /** Whether the window has a defined start, for the caption. */
  since: Date | null
}) {
  if (market.strip.length === 0) return null

  return (
    <section
      aria-label="Market over the same window"
      className="glass rounded-[var(--r-lg)] px-4 py-3"
    >
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <p className="meta">THE MARKET, SAME WINDOW</p>
        <p className="text-[11px] text-[color:var(--ink-3)]">
          {since
            ? 'measured from where your cursor sits'
            : 'measured from the previous session'}
        </p>
      </div>

      {/* A grid, not a scroller. Nine tiles overflowed the column and left a
          scrollbar across the hero with XLF cut in half — a strip you have to
          drag is one nobody reads, and the whole value here is being able to
          take the market in at a glance. */}
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-9">
        {market.strip.map((row) => (
          <Tile key={row.symbol} row={row} />
        ))}
      </div>
    </section>
  )
}

function Tile({ row }: { row: Pulse['strip'][number] }) {
  const pct = row.returnPct
  const tone =
    pct === null
      ? 'var(--ink-3)'
      : pct >= 0
        ? 'var(--up)'
        : 'var(--down)'

  return (
    <div
      title={row.name}
      className="rounded-[var(--r-md)] border border-[color:var(--border)] bg-[color:var(--surface)] px-2 py-1.5 transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-0.5 hover:border-[color:var(--border-strong)] hover:shadow-[var(--elev-2)]"
      style={{ transitionTimingFunction: 'var(--ease-spring)' }}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span className="font-mono text-[10px] tracking-wide text-[color:var(--ink-2)]">
          {row.symbol}
        </span>
        <span className="num text-[11px] font-medium" style={{ color: tone }}>
          {pct === null
            ? '—'
            : `${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(1)}%`}
        </span>
      </div>
      <div className="mt-1">
        <Sparkline points={row.sparkline} width={64} height={16} animate={false} />
      </div>
    </div>
  )
}
