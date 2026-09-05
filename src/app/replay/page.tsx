import { redirect } from 'next/navigation'
import Link from 'next/link'
import { currentUser } from '@/lib/auth'
import { replayCustom, replayScenario, SCENARIOS } from '@/lib/scenarios'
import { CustomRange } from '@/components/CustomRange'
import { Caveat } from '@/components/Caveat'
import { tradingDaysBetween } from '@/lib/market-calendar'
import { ReplayPlayer } from '@/components/ReplayPlayer'
import { Shell } from '@/components/Shell'

export const dynamic = 'force-dynamic'

/** Names used for a custom window. The semis cluster plus the mega-caps. */
const CUSTOM_SYMBOLS = ['NVDA', 'AMD', 'AVGO', 'MU', 'AAPL', 'MSFT']

function isDate(value: string | null): boolean {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export default async function ReplayPage({ searchParams }: PageProps<'/replay'>) {
  const user = await currentUser()
  if (!user) redirect('/login')

  const params = await searchParams

  // A custom window runs through the SAME function the featured scenarios do.
  // If a preset produced a better answer than an arbitrary range, the presets
  // would be the product rather than examples of it.
  const from = typeof params.from === 'string' ? params.from : null
  const to = typeof params.to === 'string' ? params.to : null
  // Bounded, and the reason is usability rather than CPU.
  //
  // Seven years of history renders in 1.6 seconds - but it produces 1,305
  // steps, and a player that advances one trading day at a time is not a
  // replay at that length, it is a haystack. The featured windows are 17 and
  // 27 steps. Refusing loudly beats truncating silently, because a user who
  // asked for 2019 and got 2026 would have no way to know.
  const MAX_SESSIONS = 120

  const rangeSessions =
    isDate(from) && isDate(to) && from! < to!
      ? tradingDaysBetween(from!, to!).length
      : 0

  const tooLong = rangeSessions > MAX_SESSIONS
  const isCustom = isDate(from) && isDate(to) && from! < to! && !tooLong

  const slug =
    typeof params.s === 'string' && SCENARIOS.some((x) => x.slug === params.s)
      ? params.s
      : SCENARIOS[0].slug

  const { scenario, steps } = isCustom
    ? await replayCustom(from!, to!, CUSTOM_SYMBOLS)
    : await replayScenario(slug)

  return (
    <Shell displayName={user.displayName}>
    <main className="mx-auto w-full max-w-3xl px-5 py-10">

      <h1 className="display rise">Watch the engine work on history</h1>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-[color:var(--ink-3)]">
        Step a real historical window forward one trading day at a time. At each
        step the engine sees only what it would have seen on that date — no
        lookahead, even though the rest of the series is sitting in the database.
      </p>

      <Caveat summary="Replay is deliberately daily, and has no headlines">
        Fifteen-minute bars are kept for thirty days to time recent moves within
        a session; reconstructing 2020 at that resolution is not possible on
        free data, so historical windows are not pretended to have it. Headlines
        are absent for the same reason — the news tier retains about two days.
      </Caveat>

      <nav className="mt-6 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] tracking-wider text-[color:var(--ink-3)]">
          FEATURED
        </span>
        {SCENARIOS.map((s) => (
          <Link
            key={s.slug}
            href={`/replay?s=${s.slug}`}
            className="btn px-3 py-1.5 font-mono text-xs"
            style={
              s.slug === slug
                ? { borderColor: 'var(--accent)', color: 'var(--accent-ink)' }
                : {
                    borderColor: 'var(--border-strong)',
                    color: 'var(--ink-3)',
                  }
            }
          >
            {s.name}
          </Link>
        ))}
      </nav>

      <CustomRange from={from} to={to} active={isCustom} />

      {tooLong && (
        <div
          className="mt-4 rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--accent)', color: 'var(--accent-ink)' }}
          role="status"
        >
          <span className="font-mono text-[10px] tracking-wider">
            RANGE TOO LONG
          </span>{' '}
          {from} to {to} is {rangeSessions} trading sessions. Replay steps one
          day at a time, so anything past {MAX_SESSIONS} stops being something
          you can watch. Choose a shorter window — the featured examples are
          under thirty.
        </div>
      )}

      <ReplayPlayer scenario={scenario} steps={steps} />
    </main>
    </Shell>
  )
}
