import type { Job } from 'bullmq'
import { db } from '../src/lib/db'
import type { AuxJob } from '../src/lib/queue'
import { FinnhubSource, rankNews } from '../src/lib/sources/finnhub'
import { TwelveDataSource } from '../src/lib/sources/twelvedata'
import { fixtureMode } from '../src/lib/sources/fixture'
import { sweepExpiredSessions } from '../src/lib/auth'
import { nyDate } from '../src/lib/market-calendar'

/**
 * Everything that is not a daily bar or a recompute.
 *
 * Kept out of `index.ts` because these jobs share exactly one property: none
 * of them is on the critical path. A failure here degrades the brief — less
 * chronology, no headlines, a stale earnings flag — but must never break it,
 * so each handler fails loudly in the log and quietly on the screen.
 */

/** How long 15-minute bars are kept. They answer "when", not "what". */
export const INTRADAY_RETENTION_DAYS = 30

/** Dead letters and login audit rows, kept long enough to investigate. */
const DEAD_LETTER_RETENTION_DAYS = 90
const LOGIN_AUDIT_RETENTION_DAYS = 90

async function activeSymbols(): Promise<
  Array<{ id: string; symbol: string; name: string }>
> {
  return db.instrument.findMany({
    where: { isActive: true },
    select: { id: true, symbol: true, name: true },
    orderBy: { symbol: 'asc' },
  })
}

/**
 * 15-minute bars for the recent window.
 *
 * NOT an analytical input — no detector reads this table. It exists so the
 * brief can say "Tuesday morning" instead of "Tuesday".
 */
async function ingestIntraday(): Promise<object> {
  if (fixtureMode()) {
    // Committed fixtures are daily only. Rather than fabricate intraday bars,
    // the job reports honestly that chronology is unavailable in fixture mode.
    return { skipped: 'fixture mode has no intraday history' }
  }
  const key = process.env.TWELVE_DATA_API_KEY
  if (!key) return { skipped: 'no TWELVE_DATA_API_KEY' }

  const source = new TwelveDataSource(key)
  const instruments = await activeSymbols()
  let stored = 0

  for (const inst of instruments) {
    try {
      const bars = await source.fetchIntradayBars(
        inst.symbol,
        INTRADAY_RETENTION_DAYS,
      )
      if (bars.length === 0) continue

      const result = await db.intradayBar.createMany({
        data: bars.map((b) => ({
          instrumentId: inst.id,
          at: new Date(b.at),
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: BigInt(Math.round(b.volume)),
          source: source.id,
        })),
        skipDuplicates: true,
      })
      stored += result.count
    } catch (e) {
      console.error(`[aux] intraday ${inst.symbol}: ${(e as Error).message}`)
    }
  }

  return { stored }
}

/**
 * Headlines, attached to instruments — never to scores.
 *
 * Ranked by distinct outlets rather than article count, because the provider
 * returns hundreds of syndicated copies from a handful of sources.
 */
async function ingestNews(): Promise<object> {
  if (fixtureMode()) {
    return { skipped: 'fixture mode makes no network calls' }
  }
  const key = process.env.FINNHUB_API_KEY
  if (!key) return { skipped: 'no FINNHUB_API_KEY' }

  const source = new FinnhubSource(key)
  const instruments = await activeSymbols()

  const to = nyDate(new Date())
  const fromDate = new Date()
  fromDate.setUTCDate(fromDate.getUTCDate() - 3)
  const from = fromDate.toISOString().slice(0, 10)

  let stored = 0

  for (const inst of instruments) {
    try {
      const articles = await source.fetchNews(inst.symbol, from, to)
      const ranked = rankNews(inst.symbol, inst.name, articles)
      if (ranked.length === 0) continue

      const result = await db.newsItem.createMany({
        data: ranked.map((a) => ({
          instrumentId: inst.id,
          publishedAt: new Date(a.publishedAt),
          headline: a.headline.slice(0, 400),
          source: a.source.slice(0, 80),
          url: a.url,
          summary: a.summary?.slice(0, 1000) ?? null,
          corroboration: a.corroboration,
          fingerprint: a.fingerprint,
        })),
        skipDuplicates: true,
      })
      stored += result.count
    } catch (e) {
      console.error(`[aux] news ${inst.symbol}: ${(e as Error).message}`)
    }
  }

  return { stored }
}

/**
 * The forward earnings calendar.
 *
 * Previously loaded ONLY by scripts/backfill.ts, so in the running system it
 * went stale and `earnings_upcoming` quietly stopped firing — a detector
 * present in the scorer and absent from reality.
 */
async function ingestEarnings(): Promise<object> {
  if (fixtureMode()) {
    return { skipped: 'fixture mode makes no network calls' }
  }
  const key = process.env.FINNHUB_API_KEY
  if (!key) return { skipped: 'no FINNHUB_API_KEY' }

  const source = new FinnhubSource(key)
  const instruments = await activeSymbols()
  const bySymbol = new Map(instruments.map((i) => [i.symbol, i.id]))

  const from = nyDate(new Date())
  const toDate = new Date()
  toDate.setUTCDate(toDate.getUTCDate() + 90)
  const to = toDate.toISOString().slice(0, 10)

  const rows = await source.fetchEarnings([...bySymbol.keys()], from, to)
  let stored = 0

  for (const r of rows) {
    const instrumentId = bySymbol.get(r.symbol)
    if (!instrumentId) continue

    await db.earningsEvent.upsert({
      where: {
        instrumentId_reportDate: {
          instrumentId,
          reportDate: new Date(`${r.reportDate}T00:00:00Z`),
        },
      },
      create: {
        instrumentId,
        reportDate: new Date(`${r.reportDate}T00:00:00Z`),
        session: r.session,
        epsEstimate: r.epsEstimate,
        epsActual: r.epsActual,
        source: source.id,
      },
      update: {
        session: r.session,
        epsEstimate: r.epsEstimate,
        epsActual: r.epsActual,
      },
    })
    stored++
  }

  return { stored }
}

/**
 * Housekeeping.
 *
 * Nothing here touches the market, so it runs regardless of the calendar — and
 * every retention rule lives in one place rather than being implied by
 * whichever query happens to run. A database with no stated retention policy
 * grows until someone notices.
 */
async function maintain(): Promise<object> {
  const now = Date.now()
  const cutoff = (days: number) => new Date(now - days * 86_400_000)

  const sessions = await sweepExpiredSessions()

  const intraday = await db.intradayBar.deleteMany({
    where: { at: { lt: cutoff(INTRADAY_RETENTION_DAYS) } },
  })
  const deadLetters = await db.deadLetter.deleteMany({
    where: { createdAt: { lt: cutoff(DEAD_LETTER_RETENTION_DAYS) } },
  })
  const logins = await db.loginAttempt.deleteMany({
    where: { attemptAt: { lt: cutoff(LOGIN_AUDIT_RETENTION_DAYS) } },
  })

  return {
    sessions,
    intraday: intraday.count,
    deadLetters: deadLetters.count,
    loginAttempts: logins.count,
  }
}

export async function handleAux(job: Job<AuxJob>): Promise<object> {
  switch (job.data.kind) {
    case 'intraday':
      return ingestIntraday()
    case 'news':
      return ingestNews()
    case 'earnings':
      return ingestEarnings()
    case 'maintenance':
      return maintain()
  }
}
