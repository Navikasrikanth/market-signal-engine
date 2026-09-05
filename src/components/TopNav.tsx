import Link from 'next/link'
import { SignOut } from './SignOut'

/**
 * One navigation bar, on every signed-in page.
 *
 * It exists because two things were unreachable rather than unbuilt: sign-out
 * lived at the bottom of the watchlist page, and the three views of the same
 * data had no way to reach each other. Both were features nobody could find.
 *
 * The three views answer genuinely different questions, which is why they are
 * separate rather than tabs on one screen:
 *
 *   brief      what changed, ranked and cut to your attention budget
 *   everything the same market with no opinion applied at all
 *   positions  what it means for what you said you were doing
 */
const VIEWS = [
  { href: '/', label: 'brief' },
  { href: '/market', label: 'everything' },
  { href: '/positions', label: 'positions' },
] as const

const TOOLS = [
  { href: '/watchlist', label: 'watchlist' },
  { href: '/performance', label: 'track record' },
  { href: '/replay', label: 'replay' },
] as const

export function TopNav({
  current,
  asOf,
}: {
  /** Path of the page rendering this, so the active view is marked. */
  current: string
  /** Data freshness, shown once rather than repeated per page. */
  asOf?: string | null
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
      <span className="flex items-baseline gap-4">
        <span className="font-mono text-[11px] tracking-[0.2em] text-[color:var(--accent-ink)]">
          SITREP
        </span>
        <span className="flex items-baseline gap-3 font-mono text-[11px]">
          {VIEWS.map((v) => (
            <Link
              key={v.href}
              href={v.href}
              aria-current={v.href === current ? 'page' : undefined}
              className="tracking-wide"
              style={
                v.href === current
                  ? { color: 'var(--accent-ink)' }
                  : { color: 'var(--ink-3)' }
              }
            >
              {v.label}
            </Link>
          ))}
        </span>
      </span>

      <span className="flex flex-wrap items-baseline gap-4 font-mono text-[10px] tracking-wide text-[color:var(--ink-3)]">
        {asOf !== undefined && (
          <span>
            {asOf
              ? `data as of ${new Date(asOf).toISOString().slice(0, 10)}`
              : 'no data yet'}
          </span>
        )}
        {TOOLS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="underline decoration-dotted underline-offset-4 hover:text-[color:var(--accent-ink)]"
          >
            {t.label}
          </Link>
        ))}
        <SignOut />
      </span>
    </div>
  )
}
