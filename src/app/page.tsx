import { redirect } from 'next/navigation'
import Link from 'next/link'
import { currentUser } from '@/lib/auth'
import { buildSitrep } from '@/lib/sitrep'
import { EventCard } from '@/components/EventCard'
import { StoryBlock } from '@/components/StoryBlock'
import { ThemeCard } from '@/components/ThemeCard'
import { AttentionBudget } from '@/components/AttentionBudget'
import { MarkAllSeen } from '@/components/MarkAllSeen'
import { Shell } from '@/components/Shell'
import { AttentionField, type FieldPoint } from '@/components/AttentionField'
import { MarketPulse } from '@/components/MarketPulse'

export const dynamic = 'force-dynamic'

/**
 * THE SITREP.
 *
 * Server-rendered on purpose: the whole product is about the moment you come
 * back, so the answer should already be on the page when it paints rather than
 * arriving after a spinner.
 */
export default async function Page() {
  const user = await currentUser()
  if (!user) redirect('/login')

  const sitrep = await buildSitrep(user.id)

  /*
   * The field, from data the brief already has.
   *
   * `all` is every watched name ranked without the budget applied, so the
   * points below the line are not a decorative filler set - they are the
   * specific names the product decided not to show, which is the thing being
   * argued. `items` is what survived the cut, so membership in it is what
   * "surfaced" means, rather than a threshold guessed at again here.
   */
  const surfaced = new Set(sitrep.items.map((i) => i.symbol))
  const field: FieldPoint[] = sitrep.all.map((i) => ({
    symbol: i.symbol,
    score: i.attentionScore,
    severity: i.severity,
    surfaced: surfaced.has(i.symbol),
  }))

  return (
    <Shell displayName={sitrep.displayName} asOf={sitrep.asOf}>
    <main className="mx-auto w-full max-w-3xl px-5 py-10">
      <Header sitrep={sitrep} field={field} />

      <StalenessWarning
        sessionsBehind={sitrep.dataQuality.sessionsBehind}
        holes={sitrep.dataQuality.holes}
      />

      {sitrep.watchlistSize === 0 ? (
        <EmptyWatchlist />
      ) : sitrep.quiet ? (
        <QuietState
          watchlistSize={sitrep.watchlistSize}
          snoozedCount={sitrep.snoozedCount}
        />
      ) : (
        <>
          <section className="mt-6 flex flex-col gap-3">
            {sitrep.items.map((item, i) => (
              /* Staggered by rank, so the brief arrives in the order it is
                 ranked in. Capped at five steps: past that the last card is
                 waiting on an animation rather than on data. */
              <div
                key={item.symbol}
                className="rise"
                style={{ animationDelay: `${Math.min(i, 5) * 45}ms` }}
              >
                <EventCard item={item} trackRecord={sitrep.trackRecord} />
              </div>
            ))}
          </section>

          <CollapseLine
            belowBudget={sitrep.belowBudget}
            withinNormalRange={sitrep.withinNormalRange}
            snoozedCount={sitrep.snoozedCount}
          />
        </>
      )}

      <div className="reveal mt-8 flex flex-col gap-4">
        <Chronology
          entries={sitrep.chronology}
          cameAndWent={sitrep.cameAndWent}
        />

        <StoryBlock narrative={sitrep.narrative} />

        {sitrep.themes.map((theme) => (
          <ThemeCard key={theme.id} theme={theme} />
        ))}

        {/* An all-zero budget bar makes an argument about filtering to someone
            who has nothing to filter. */}
        {sitrep.watchlistSize > 0 && (
          <AttentionBudget
            budget={sitrep.budget}
            watchlistSize={sitrep.watchlistSize}
            snoozedCount={sitrep.snoozedCount}
          />
        )}
      </div>

      {sitrep.watchlistSize > 0 && <Footer sitrep={sitrep} />}
    </main>
    </Shell>
  )
}

function Header({
  sitrep,
  field,
}: {
  sitrep: Awaited<ReturnType<typeof buildSitrep>>
  field: FieldPoint[]
}) {
  const hours = sitrep.absenceHours
  const away =
    hours === null
      ? null
      : hours < 36
        ? `${Math.round(hours)} hours ago`
        : `${Math.round(hours / 24)} days ago`

  return (
    <header>
      <h1 className="display rise">
        Good morning, {sitrep.displayName}.
      </h1>

      {/* Nobody with an empty watchlist has "last checked" anything, and
          telling them nothing needs their attention is not the point. */}
      {sitrep.watchlistSize > 0 && (
        <>
          <p className="mt-4 font-mono text-[11px] tracking-wider text-[color:var(--ink-3)]">
            {away
              ? `HERE'S WHAT CHANGED SINCE YOU LAST CHECKED — ${away.toUpperCase()}`
              : "HERE'S WHAT CHANGED SINCE YOU LAST CHECKED"}
          </p>

          {/*
            Ground the window in a recorded fact rather than a computed
            estimate. The cursor says when the data was last acknowledged; the
            sign-in audit says when the person was actually last here.
          */}
          {sitrep.previousVisit && (
            <p className="mt-1 text-xs text-[color:var(--ink-3)]">
              You last signed in on{' '}
              {sitrep.previousVisit.at.toISOString().slice(0, 10)} at{' '}
              {sitrep.previousVisit.at.toISOString().slice(11, 16)} UTC.
            </p>
          )}

          {/*
            The shape of the absence, before any card. Counts of things already
            computed - a reader arriving after ten weeks should not have to
            parse five ranked cards to learn what kind of ten weeks it was.
          */}
          {sitrep.absenceSummary && (
            <p className="mt-3 text-[15px] leading-snug text-[color:var(--ink-2)]">
              {sitrep.absenceSummary}
            </p>
          )}

          <div className="mt-4">
            <MarketPulse market={sitrep.market} since={sitrep.since} />
          </div>

          {/*
            The whole argument, as one picture: every name you watch is a
            point, and the line is the budget. Most of the field sits below
            it, which is the product working rather than the product being
            quiet - and no sentence makes that as immediate as seeing it.
          */}
          {field.length > 0 && (
            <figure className="mt-4">
              <AttentionField points={field} budget={sitrep.attentionBudget} />
              <figcaption className="mt-1 text-xs text-[color:var(--ink-3)]">
                Each point is a name you watch, placed by attention score.
                Points above the line reached your brief; the rest were found
                and held back.
              </figcaption>
            </figure>
          )}

          <div className="mt-5 flex items-center justify-between gap-4">
            <p className="text-lg text-[color:var(--ink-2)]">
              {sitrep.items.length === 0
                ? 'Nothing needs your attention.'
                : `${sitrep.items.length} thing${sitrep.items.length === 1 ? '' : 's'} need${sitrep.items.length === 1 ? 's' : ''} your attention.`}
            </p>
            {sitrep.items.length > 0 && <MarkAllSeen />}
          </div>
        </>
      )}
    </header>
  )
}

/**
 * Say so when the data is behind.
 *
 * The single most dangerous failure this product has is silence: missing data
 * renders as a calm market, and a calm market is a real answer here. Once
 * ingestion runs unattended, an outage would otherwise look exactly like
 * nothing happening.
 *
 * Measured in trading sessions, so a weekend never triggers it — a warning
 * that cries wolf every Saturday is one users learn to ignore by Tuesday.
 */
function StalenessWarning({
  sessionsBehind,
  holes,
}: {
  sessionsBehind: number
  holes: number
}) {
  if (sessionsBehind === 0 && holes === 0) return null

  return (
    <div
      className="mt-4 rounded-md border px-3 py-2 text-sm"
      style={{ borderColor: 'var(--accent)', color: 'var(--accent-ink)' }}
      role="status"
    >
      <span className="font-mono text-[10px] tracking-wider">DATA IS BEHIND</span>{' '}
      {sessionsBehind > 0 && (
        <>
          The newest prices are {sessionsBehind} trading session
          {sessionsBehind === 1 ? '' : 's'} old.{' '}
        </>
      )}
      {holes > 0 && (
        <>
          {holes} session{holes === 1 ? ' is' : 's are'} missing from the recent
          history.{' '}
        </>
      )}
      Treat this brief as incomplete rather than as a quiet market.
    </div>
  )
}

/**
 * What happened, in order — and what came and went.
 *
 * The ranked cards answer "what matters now". This answers "what happened",
 * which is what someone returning after a fortnight asks first and which
 * ranking structurally cannot tell them: ranking only sees the present, so an
 * event that fired and resolved while they were away is invisible in it. That
 * is a silent omission, and it is exactly what "you missed" means.
 */
function Chronology({
  entries,
  cameAndWent,
}: {
  entries: Awaited<ReturnType<typeof buildSitrep>>['chronology']
  cameAndWent: Awaited<ReturnType<typeof buildSitrep>>['cameAndWent']
}) {
  if (entries.length === 0 && cameAndWent.length === 0) return null

  return (
    <section className="card p-4">
      <h2 className="mb-3 font-mono text-[10px] tracking-wider text-[color:var(--ink-3)]">
        WHILE YOU WERE AWAY
      </h2>

      {entries.length > 0 && (
        <ol className="flex flex-col gap-2 border-l border-[color:var(--border-strong)] pl-4">
          {entries.map((e, i) => (
            <li key={`${e.date}-${e.symbol}-${i}`} className="text-sm">
              <span className="tabular font-mono text-[11px] text-[color:var(--ink-3)]">
                {e.date}
                {e.timeOfDay ? ` ${e.timeOfDay}` : ''}
              </span>
              <span className="ml-2 text-[color:var(--ink-2)]">
                {e.symbol ? `${e.symbol} — ` : ''}
                {e.text}
              </span>
            </li>
          ))}
        </ol>
      )}

      {cameAndWent.length > 0 && (
        <div className="mt-4 border-t border-[color:var(--border)] pt-3">
          <p className="mb-2 font-mono text-[10px] tracking-wider text-[color:var(--ink-3)]">
            CAME AND WENT
          </p>
          <ul className="flex flex-col gap-1 text-sm text-[color:var(--ink-2)]">
            {cameAndWent.map((c) => (
              <li key={c.symbol}>
                <span className="font-mono text-xs">{c.symbol}</span> · {c.date}{' '}
                — {c.headline}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[color:var(--ink-3)]">
            These are no longer ranked, because they are no longer true. They
            are here because they happened while you were gone, and a brief that
            only shows what still holds would never mention them at all.
          </p>
        </div>
      )}
    </section>
  )
}

function CollapseLine({
  belowBudget,
  withinNormalRange,
  snoozedCount,
}: {
  belowBudget: number
  withinNormalRange: number
  snoozedCount: number
}) {
  return (
    <p className="mt-4 text-sm text-[color:var(--ink-3)]">
      {belowBudget > 0 && (
        <>
          <span className="text-[color:var(--ink-2)]">{belowBudget} more</span>{' '}
          {belowBudget === 1 ? 'was' : 'were'} flagged but fell below your
          attention budget.{' '}
        </>
      )}
      {withinNormalRange} instrument{withinNormalRange === 1 ? '' : 's'} moved
      within {withinNormalRange === 1 ? 'its' : 'their'} normal range.
      {snoozedCount > 0 && (
        <>
          {' '}
          <span className="text-[color:var(--ink-2)]">
            {snoozedCount} snoozed
          </span>{' '}
          — still pending, not cleared.
        </>
      )}
    </p>
  )
}

/**
 * The very first screen a new account sees.
 *
 * Distinct from the quiet state on purpose: "0 names moved within their normal
 * range" is technically true and completely useless. A user with nothing on
 * their watchlist needs the next action, not a report.
 */
function EmptyWatchlist() {
  return (
    <section className="glass rise mt-6 rounded-[var(--r-xl)] p-10 text-center">
      {/* The field, empty. It is the same picture the brief will show once
          there is something to plot, so the first screen already introduces
          the idea the product is built on rather than apologising for having
          no data. */}
      <EmptyField />
      <p className="meta mt-6">NOTHING WATCHED YET</p>
      <p className="mt-3 text-lg text-[color:var(--ink-2)]">
        Pick a few names and SITREP starts keeping watch.
      </p>
      <p className="mt-2 text-sm text-[color:var(--ink-3)]">
        Your first brief covers everything that happens between now and the next
        time you open it.
      </p>
      <Link
        href="/watchlist"
        className="mt-5 inline-block btn px-3 py-1.5 font-mono text-[11px] tracking-wide"
      >
        Build your watchlist →
      </Link>
    </section>
  )
}

function QuietState({
  watchlistSize,
  snoozedCount,
}: {
  watchlistSize: number
  snoozedCount: number
}) {
  // An empty brief has two very different causes, and saying the wrong one is
  // worse than saying nothing: the market was calm, or the user muted it.
  const calm = watchlistSize - snoozedCount

  return (
    <section className="glass rise mt-6 rounded-[var(--r-xl)] p-10 text-center">
      <p className="meta">
        {snoozedCount > 0 ? 'NOTHING NEW' : 'YOUR MARKET IS QUIET'}
      </p>
      <p className="mt-3 text-lg text-[color:var(--ink-2)]">
        Nothing requires your attention.
      </p>
      <p className="mt-2 text-sm text-[color:var(--ink-3)]">
        {calm} name{calm === 1 ? '' : 's'} moved within{' '}
        {calm === 1 ? 'its' : 'their'} normal range.
        {snoozedCount > 0 ? (
          <>
            {' '}
            <span className="text-[color:var(--ink-2)]">
              {snoozedCount} snoozed
            </span>{' '}
            — still pending, not cleared.
          </>
        ) : (
          ' This is a real answer, not an empty screen.'
        )}
      </p>
    </section>
  )
}

function Footer({
  sitrep,
}: {
  sitrep: Awaited<ReturnType<typeof buildSitrep>>
}) {
  return (
    <footer className="mt-10 border-t border-[color:var(--border)] pt-4">
      <p className="font-mono text-[10px] leading-relaxed tracking-wide text-[color:var(--ink-3)]">
        {sitrep.watchlistSize} instrument
        {sitrep.watchlistSize === 1 ? '' : 's'} watched ·{' '}
        {sitrep.dataQuality.unconfirmedCount} unconfirmed · prices reconciled
        across two independent sources
      </p>
    </footer>
  )
}

/**
 * The attention field with nothing in it.
 *
 * A still SVG rather than the canvas, because there is genuinely nothing to
 * plot and drifting fake points would be exactly the invented data this
 * product refuses everywhere else. What it shows is the idea: a line, and the
 * space above and below it that names will eventually fall into.
 */
function EmptyField() {
  return (
    <svg
      viewBox="0 0 320 96"
      className="mx-auto w-full max-w-[320px]"
      role="img"
      aria-label="An empty attention field: the budget line, with no names on it yet"
    >
      <line
        x1="16"
        y1="38"
        x2="304"
        y2="38"
        stroke="var(--accent)"
        strokeOpacity="0.3"
        strokeWidth="1"
        strokeDasharray="3 5"
      />
      <text
        x="16"
        y="30"
        fill="var(--accent)"
        fillOpacity="0.6"
        fontSize="9"
        fontFamily="ui-monospace, monospace"
        letterSpacing="1"
      >
        ATTENTION BUDGET
      </text>
      {/* A few hollow markers below the line - the shape a watched but quiet
          market takes, drawn as outlines so nothing reads as a real value. */}
      {[52, 96, 140, 184, 228, 272].map((x, i) => (
        <circle
          key={x}
          cx={x}
          cy={62 + (i % 3) * 9}
          r="3"
          fill="none"
          stroke="var(--border-strong)"
          strokeWidth="1"
        />
      ))}
    </svg>
  )
}
