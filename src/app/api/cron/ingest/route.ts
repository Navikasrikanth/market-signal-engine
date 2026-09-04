import { requireCronSecret } from '@/lib/api'
import { handler, ok } from '@/lib/api'
import { getIngestQueue } from '@/lib/queue'
import { findGaps, repairWindow, summariseGaps } from '@/lib/ingest/gaps'
import { nyDate } from '@/lib/market-calendar'

/**
 * Enqueue ingestion for whatever is actually missing.
 *
 * The route only ENQUEUES. It does no provider I/O, so it returns in
 * milliseconds regardless of how slow or rate-limited the upstream feeds are,
 * and a scheduler never has to hold a connection open for minutes.
 *
 * It used to request a fixed ten-day trailing window for every symbol, which
 * failed twice over: an outage longer than ten days left a hole that could
 * never heal, and a date missing from the middle of the series was never
 * looked for at all. Now each instrument is asked for exactly the sessions the
 * market calendar says it should have and does not — and an instrument with
 * nothing missing is not requested at all, which is the difference between
 * spending 26 provider credits a cycle and spending none.
 *
 * Guarded by a shared secret rather than a session: it is called by a
 * scheduler, not a person.
 */
export const POST = handler(async (req) => {
  requireCronSecret(req)

  const now = new Date()
  const gaps = await findGaps(now)
  const summary = summariseGaps(gaps)

  const queue = getIngestQueue()

  const jobs = gaps
    .map((gap) => ({ gap, window: repairWindow(gap) }))
    .filter(
      (x): x is { gap: (typeof gaps)[number]; window: { from: string; to: string } } =>
        x.window !== null,
    )
    .map(({ gap, window }) => ({
      name: 'ingest-symbol',
      data: { symbol: gap.symbol, from: window.from, to: window.to },
      // The natural key includes the window, so a run needing a WIDER range
      // than an earlier one today is not silently deduplicated away as a job
      // that has already been seen.
      // BullMQ forbids ":" in custom job ids.
      opts: { jobId: `ingest-${gap.symbol}-${window.from}-${window.to}` },
    }))

  const enqueued = jobs.length ? (await queue.addBulk(jobs)).length : 0

  return ok({
    enqueued,
    date: nyDate(now),
    upToDate: gaps.length - jobs.length,
    holesFound: summary.totalHoles,
    instrumentsWithHoles: summary.instrumentsWithHoles,
    worstSessionsBehind:
      summary.worstSessionsBehind === Infinity
        ? null
        : summary.worstSessionsBehind,
  })
})
