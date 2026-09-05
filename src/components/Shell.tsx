'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

/**
 * The application shell.
 *
 * A collapsible rail rather than a top bar, because this is a command centre
 * with seven destinations and a top bar treats them all as equally important.
 * The rail separates the three VIEWS — which answer different questions about
 * the same data — from the tools, which are places you visit occasionally.
 *
 * Every accessible name here is frozen. Four browser journeys navigate by link
 * text, and a rename that quietly breaks them would be exactly the kind of
 * "harmless UI change" that costs an afternoon.
 */

interface Item {
  href: string
  label: string
  icon: React.ReactNode
  hint: string
}

const VIEWS: Item[] = [
  {
    href: '/',
    label: 'brief',
    hint: 'What changed since you last looked',
    icon: (
      <path d="M4 5h12M4 9h8M4 13h10M4 17h6" strokeLinecap="round" />
    ),
  },
  {
    href: '/market',
    label: 'everything',
    hint: 'The same names, unfiltered',
    icon: (
      <>
        <rect x="3" y="4" width="14" height="12" rx="1.5" />
        <path d="M3 8h14M8 8v8" />
      </>
    ),
  },
  {
    href: '/positions',
    label: 'positions',
    hint: 'What it means for what you hold',
    icon: (
      <>
        <path d="M3 15l4-5 3 3 4-6 3 4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3 18h14" strokeLinecap="round" />
      </>
    ),
  },
]

const TOOLS: Item[] = [
  {
    href: '/watchlist',
    label: 'watchlist',
    hint: 'Names, priority, intent',
    icon: (
      <>
        <path d="M4 6h12M4 10h12M4 14h8" strokeLinecap="round" />
        <circle cx="15" cy="14" r="2" />
      </>
    ),
  },
  {
    href: '/performance',
    label: 'track record',
    hint: 'How often each detector was right',
    icon: (
      <>
        <path d="M4 16V9M9 16V5M14 16v-4" strokeLinecap="round" />
        <path d="M2 18h16" strokeLinecap="round" />
      </>
    ),
  },
  {
    href: '/replay',
    label: 'replay',
    hint: 'Step through history one day at a time',
    icon: (
      <>
        <circle cx="10" cy="10" r="7" />
        <path d="M10 6v4l3 2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  {
    href: '/admin/pipeline',
    label: 'pipeline',
    hint: 'Data quality, queues, freshness',
    icon: (
      <>
        <path d="M3 7h6l2 3h6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="4" cy="14" r="1.5" />
        <path d="M6 14h10" strokeLinecap="round" />
      </>
    ),
  },
]

export function Shell({
  children,
  displayName,
  asOf,
}: {
  children: React.ReactNode
  displayName?: string
  asOf?: string | null
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [ready, setReady] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  // Read the stored preference after mount. Rendering expanded first and
  // snapping narrow would be a visible jolt on every navigation, so the rail
  // holds its transition until it knows which state it is in.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('sitrep:rail') === 'collapsed')
    } catch {
      // Private mode, or storage disabled. Expanded is the safe default.
    }
    setReady(true)
  }, [])

  function toggle() {
    setCollapsed((c) => {
      const next = !c
      try {
        localStorage.setItem('sitrep:rail', next ? 'collapsed' : 'open')
      } catch {
        // A preference we cannot persist is still a preference for this visit.
      }
      return next
    })
  }

  async function signOut() {
    setSigningOut(true)
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' })
      if (!res.ok) throw new Error(String(res.status))
      // Refresh before navigating: `push` alone can serve a payload rendered
      // while the session still existed, so the brief flashes back.
      router.refresh()
      router.push('/login')
    } catch {
      setSigningOut(false)
    }
  }

  return (
    <div className="flex min-h-screen">
      <aside
        className="glass-strong sticky top-0 hidden h-screen shrink-0 flex-col border-y-0 border-l-0 lg:flex"
        style={{
          width: collapsed ? 'var(--rail-w-collapsed)' : 'var(--rail-w)',
          transition: ready
            ? 'width var(--dur-base) var(--ease-out)'
            : 'none',
        }}
      >
        <div className="flex items-center gap-2 px-4 pt-5 pb-6">
          <Mark />
          {!collapsed && (
            <span className="font-mono text-[11px] tracking-[0.28em] text-[color:var(--accent-ink)]">
              SITREP
            </span>
          )}
        </div>

        <Group items={VIEWS} label="VIEWS" collapsed={collapsed} pathname={pathname} />
        <div className="mt-5">
          <Group items={TOOLS} label="TOOLS" collapsed={collapsed} pathname={pathname} />
        </div>

        <div className="mt-auto px-3 pb-4">
          {asOf !== undefined && !collapsed && (
            <p className="meta mb-3 px-2">
              {asOf
                ? `data as of ${new Date(asOf).toISOString().slice(0, 10)}`
                : 'no data yet'}
            </p>
          )}

          <div className="flex items-center gap-2 rounded-[var(--r-md)] border border-[color:var(--border)] bg-[color:var(--surface)] p-2">
            <span
              className="grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold"
              style={{
                background: 'var(--accent-dim)',
                color: 'var(--accent-ink)',
              }}
            >
              {(displayName ?? 'S').slice(0, 1).toUpperCase()}
            </span>
            {!collapsed && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-[color:var(--ink-2)]">
                  {displayName ?? 'Signed in'}
                </span>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  disabled={signingOut}
                  className="font-mono text-[10px] tracking-wide text-[color:var(--ink-3)] underline decoration-dotted underline-offset-4 transition-colors hover:text-[color:var(--accent-ink)] disabled:opacity-50"
                >
                  {signingOut ? 'signing out…' : 'sign out'}
                </button>
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="btn mt-2 flex w-full items-center justify-center py-1.5"
          >
            <svg
              viewBox="0 0 20 20"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              style={{
                transform: collapsed ? 'rotate(180deg)' : 'none',
                transition: 'transform var(--dur-base) var(--ease-out)',
              }}
            >
              <path d="M12 5l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </aside>

      {/* Below lg the rail becomes a bar, so nothing is unreachable on a laptop. */}
      <MobileBar pathname={pathname} onSignOut={() => void signOut()} />

      {/* The mobile bar is fixed, so content needs to clear it. Above `lg` the
          bar is `display:none` and this padding disappears with it — which
          also keeps it out of the accessibility tree, so the duplicated nav
          links never become a second match for the same accessible name. */}
      {/*
        Keyed on the path, so React tears the subtree down and remounts it on
        every navigation — which restarts the entrance animation. That is the
        whole page transition: no router events, no exit animation to
        coordinate, and nothing that can leave the app stuck mid-transition if
        a navigation is interrupted.
      */}
      <div key={pathname} className="page-in min-w-0 flex-1 pt-12 lg:pt-0">
        {children}
      </div>
    </div>
  )
}

/** Row height and gap, in pixels. The marker's travel is computed from these. */
const ROW_H = 36
const ROW_GAP = 2

function Group({
  items,
  label,
  collapsed,
  pathname,
}: {
  items: Item[]
  label: string
  collapsed: boolean
  pathname: string
}) {
  const activeIndex = items.findIndex((item) =>
    item.href === '/' ? pathname === '/' : pathname.startsWith(item.href),
  )

  return (
    <nav className="px-3">
      {!collapsed && <p className="meta mb-2 px-2">{label}</p>}

      <ul className="relative flex flex-col" style={{ gap: ROW_GAP }}>
        {/*
          One marker for the whole group, moved with a transform.
          
          It was previously a bar per row, toggled between the accent colour and
          transparent — which cannot slide, because there is nothing continuous
          to animate: the old bar fades out while a different element fades in.
          A single element that travels is both cheaper (one composited
          transform, no paint) and the only version that can actually move
          between destinations.
          
          Hidden entirely when no item in this group is active, rather than
          parked at row zero pointing at a page you are not on.
        */}
        <span
          aria-hidden
          className="absolute -left-3 w-[2px] rounded-r"
          style={{
            height: 20,
            top: 8,
            background: 'var(--accent)',
            boxShadow: '0 0 10px 0 var(--accent)',
            opacity: activeIndex < 0 ? 0 : 1,
            transform: `translateY(${Math.max(0, activeIndex) * (ROW_H + ROW_GAP)}px)`,
            transition:
              'transform var(--dur-slow) var(--ease-spring), opacity var(--dur-base) var(--ease-out)',
          }}
        />

        {items.map((item, i) => {
          const active = i === activeIndex
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                title={collapsed ? item.label : item.hint}
                className="group flex items-center gap-3 rounded-[var(--r-md)] px-2 transition-[background,color,transform] duration-200 hover:translate-x-0.5"
                style={{
                  height: ROW_H,
                  background: active ? 'var(--accent-dim)' : 'transparent',
                  color: active ? 'var(--accent-ink)' : 'var(--ink-3)',
                  transitionTimingFunction: 'var(--ease-out)',
                }}
              >
                <svg
                  viewBox="0 0 20 20"
                  className="size-[18px] shrink-0 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110"
                  style={{ transitionTimingFunction: 'var(--ease-spring)' }}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  {item.icon}
                </svg>
                {!collapsed && (
                  <span className="truncate font-mono text-[12px] tracking-wide">
                    {item.label}
                  </span>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/**
 * The rail collapses to a scrolling bar below `lg`.
 *
 * Same links, same accessible names — a second implementation of navigation is
 * a second place for them to drift apart, so the labels come from the same
 * arrays.
 */
function MobileBar({
  pathname,
  onSignOut,
}: {
  pathname: string
  onSignOut: () => void
}) {
  return (
    <header className="glass-strong fixed inset-x-0 top-0 z-20 flex items-center gap-3 overflow-x-auto border-x-0 border-t-0 px-4 py-2 lg:hidden">
      <Mark />
      {[...VIEWS, ...TOOLS].map((item) => {
        const active =
          item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className="shrink-0 font-mono text-[11px] tracking-wide transition-colors"
            style={{ color: active ? 'var(--accent-ink)' : 'var(--ink-3)' }}
          >
            {item.label}
          </Link>
        )
      })}
      <button
        type="button"
        onClick={onSignOut}
        className="ml-auto shrink-0 font-mono text-[11px] tracking-wide text-[color:var(--ink-3)]"
      >
        sign out
      </button>
    </header>
  )
}

/**
 * The mark: a small severity-coloured stack.
 *
 * It is the attention budget in miniature — a few bright bars over a longer
 * dim one — which is the only logo this product could honestly have.
 */
function Mark() {
  return (
    <svg viewBox="0 0 20 20" className="size-5 shrink-0" aria-hidden>
      <rect x="3" y="3.5" width="9" height="2" rx="1" fill="var(--sev-critical)" />
      <rect x="3" y="8" width="6" height="2" rx="1" fill="var(--sev-important)" />
      <rect x="3" y="12.5" width="14" height="2" rx="1" fill="var(--sev-noise)" />
    </svg>
  )
}
