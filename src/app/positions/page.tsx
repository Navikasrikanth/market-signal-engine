import { redirect } from 'next/navigation'
import Link from 'next/link'
import { currentUser } from '@/lib/auth'
import { buildSitrep, type SitrepItem } from '@/lib/sitrep'
import { TopNav } from '@/components/TopNav'
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
    <main className="mx-auto w-full max-w-3xl px-5 py-10">
      <TopNav current="/positions" asOf={sitrep.asOf} />

      <h1 className="mt-6 text-2xl font-semibold tracking-tight">
        What it means for you
      </h1>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-[color:var(--ink-3)]">
        The brief ranks by how unusual a move is. This one groups by what you
        said you were doing with each name, because the same 8% fall is a loss
        on something you hold and a cheaper entry on something you are waiting
        to buy.
      </p>

      {stated === 0 ? (
        <section className="mt-8 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-6">
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
            className="mt-4 inline-block rounded-md border border-[color:var(--border-strong)] px-3 py-1.5 font-mono text-[11px] tracking-wide text-[color:var(--ink-2)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent-ink)]"
          >
            Set your intents →
          </Link>
        </section>
      ) : (
        <div className="mt-8 flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.intent}>
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
  )
}

function PositionRow({ item }: { item: SitrepItem }) {
  const tone = item.framing?.tone

  return (
    <li
      className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3"
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
          <Sparkline points={item.sparkline} />
        </span>
      </div>

      {item.framing ? (
        <p
          className="mt-2 text-sm leading-snug"
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
