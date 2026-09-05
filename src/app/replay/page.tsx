import { redirect } from 'next/navigation'
import Link from 'next/link'
import { currentUser } from '@/lib/auth'
import { replayCustom, replayScenario, SCENARIOS } from '@/lib/scenarios'
import { CustomRange } from '@/components/CustomRange'
import { ReplayPlayer } from '@/components/ReplayPlayer'
import { TopNav } from '@/components/TopNav'

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
  const isCustom = isDate(from) && isDate(to) && from! < to!

  const slug =
    typeof params.s === 'string' && SCENARIOS.some((x) => x.slug === params.s)
      ? params.s
      : SCENARIOS[0].slug

  const { scenario, steps } = isCustom
    ? await replayCustom(from!, to!, CUSTOM_SYMBOLS)
    : await replayScenario(slug)

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10">
      <TopNav current="/replay" />

      <h1 className="mt-6 text-2xl font-semibold tracking-tight">
        Watch the engine work on history
      </h1>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-[color:var(--ink-3)]">
        Step a real historical window forward one trading day at a time. At each
        step the engine sees only what it would have seen on that date — no
        lookahead, even though the rest of the series is sitting in the database.
      </p>

      <p className="mt-2 max-w-prose text-xs leading-relaxed text-[color:var(--ink-3)]">
        Replay is deliberately DAILY. Fifteen-minute bars are kept for thirty
        days to time recent moves within a session; reconstructing 2020 at that
        resolution is not possible on free data, so historical windows are not
        pretended to have it. Headlines are absent for the same reason — the
        news tier retains about two days.
      </p>

      <nav className="mt-6 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] tracking-wider text-[color:var(--ink-3)]">
          FEATURED
        </span>
        {SCENARIOS.map((s) => (
          <Link
            key={s.slug}
            href={`/replay?s=${s.slug}`}
            className="rounded-md border px-3 py-1.5 font-mono text-xs"
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

      <ReplayPlayer scenario={scenario} steps={steps} />
    </main>
  )
}
