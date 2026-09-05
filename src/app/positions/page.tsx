import { redirect } from 'next/navigation'
import Link from 'next/link'
import { currentUser } from '@/lib/auth'
import { buildSitrep, type SitrepItem } from '@/lib/sitrep'
import { Shell } from '@/components/Shell'
import { Change, Sparkline } from '@/components/primitives'
import { INTENT_LABEL } from '@/engine/position'
import { Caveat } from '@/components/Caveat'
import type { Intent } from '@/engine/types'

export const dynamic = 'force-dynamic'

/**
 * What it means for what you said you were doing.
 *
 * The brief ranks by how unusual something is. This groups by your declared
 * relationship to it, and reframes every move accordingly — because a name you
 * hold falling 8% and a name you are waiting to buy falling 8% are the same
 * number and opposite news.
 *
 * No position size, no cost basis, no P&L. The product never asks for
 * holdings and must not imply it knows them; "you hold this" is a stated
 * intent, and every sentence here stays true without knowing how much.
 */
const ORDER: Intent[] = ['HOLDING', 'CONSIDERING_BUY', 'HEDGE', 'THEMATIC', 'NONE']

const BLURB: Record<Intent, string> = {
  HOLDING: 'Exposure you have. Down is a loss, up is a gain.',
  CONSIDERING_BUY:
    'Exposure you are weighing. Down is a better entry — the chart and the news run opposite ways here.',
  HEDGE:
    'Cover. Falling in a calm market is the cost of the cover, not a problem.',
  THEMATIC: 'An idea you are watching rather than a position you hold.',
  NONE: 'No stated intent, so nothing here is reframed.',
}

export default async function PositionsPage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  const sitrep = await buildSitrep(user.id)

  const groups = ORDER.map((intent) => ({
    intent,
    items: sitrep.all.filter((i) => i.intent === intent),
  })).filter((g) => g.items.length > 0)

  const stated = sitrep.all.filter((i) => i.intent !== 'NONE').length

  return (
    <Shell displayName={sitrep.displayName} asOf={sitrep.asOf}>
    <main className="mx-auto w-full max-w-4xl px-5 py-10">

      <h1 className="display rise">What it means for you</h1>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-[color:var(--ink-3)]">
        The brief ranks by how unusual a move is. This one groups by what you
        said you were doing with each name, because the same 8% fall is a loss
        on something you hold and a cheaper entry on something you are waiting
        to buy.
      </p>

      {stated === 0 ? (
        <section className="glass mt-8 rounded-[var(--r-lg)] p-6">
          <p className="font-mono text-[10px] tracking-wider text-[color:var(--ink-3)]">
            NOTHING TO REFRAME YET
          </p>
          <p className="mt-3 text-sm leading-relaxed text-[color:var(--ink-2)]">
            None of your names has a stated intent, so there is no position to
            read a move against.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-[color:var(--ink-3)]">
            Set one per name on the watchlist. It is a declaration, not a
            holdings import — nothing here asks what you own or how much.
          </p>
          <Link
            href="/watchlist"
            className="btn mt-4 inline-block px-3 py-1.5 font-mono text-[11px] tracking-wide"
          >
            Set your intents →
          </Link>
        </section>
      ) : (
        /* Columns rather than a stack. The whole point of this page is that
           the same move means different things in different groups, and a
           reader can only make that comparison when the groups are beside each
           other instead of one below the next. */
        /* Two columns only when there are two things to compare. With a
           single stated intent the grid left half the page empty, which reads
           as a missing column rather than as a deliberate layout. */
        <div
          className={`mt-8 grid gap-5 ${
            groups.length > 1 ? 'md:grid-cols-2' : ''
          }`}
        >
          {groups.map((g, gi) => (
            <section
              key={g.intent}
              className="card rise p-4"
              style={{ animationDelay: `${gi * 60}ms` }}
            >
              <h2 className="font-mono text-[11px] tracking-wider text-[color:var(--accent-ink)]">
                {INTENT_LABEL[g.intent].toUpperCase()} · {g.items.length}
              </h2>
              <p className="mt-1 text-xs text-[color:var(--ink-3)]">
                {BLURB[g.intent]}
              </p>

              <ul className="mt-3 flex flex-col gap-2">
                {g.items.map((item) => (
                  <PositionRow key={item.symbol} item={item} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <div className="mt-8">
        <Caveat summary="No position size, cost basis or profit — anywhere, ever">
          None is stored and none is asked for. Intent is something you
          declared, not a brokerage link: it changes how a move is described,
          never what the engine measured.
        </Caveat>
      </div>
    </main>
    </Shell>
  )
}

function PositionRow({ item }: { item: SitrepItem }) {
  const tone = item.framing?.tone

  return (
    <li
      className="rounded-[var(--r-md)] border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3 transition-colors hover:border-[color:var(--border-strong)]"
      style={{
        borderLeft: `2px solid ${
          tone === 'favourable'
            ? 'var(--up)'
            : tone === 'adverse'
              ? 'var(--down)'
              : 'var(--border-strong)'
        }`,
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold">{item.symbol}</span>
          <span className="text-xs text-[color:var(--ink-3)]">{item.name}</span>
        </span>
        <span className="flex items-center gap-3">
          <Change pct={item.windowReturnPct} />
          <Sparkline points={item.sparkline} animate={false} />
        </span>
      </div>

      {item.framing ? (
        <p
          className="mt-2 text-[15px] leading-snug"
          style={{
            color:
              tone === 'favourable'
                ? 'var(--up)'
                : tone === 'adverse'
                  ? 'var(--down)'
                  : 'var(--ink-2)',
          }}
        >
          {item.framing.text}
        </p>
      ) : (
        <p className="mt-2 text-sm leading-snug text-[color:var(--ink-2)]">
          {item.headline}
        </p>
      )}
    </li>
  )
}
