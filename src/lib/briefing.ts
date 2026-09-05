import { db } from './db'
import type { ChronologyEntry } from './sitrep'
import { nyMinutes } from './market-calendar'

/**
 * What happened while you were away, in order.
 *
 * The ranked cards answer "what matters now". A returning user asks something
 * else first — what happened, and when — and ranking cannot answer it, because
 * ranking only ever sees the present. Two things follow:
 *
 *   - a dated spine, so the absence has a shape rather than being a list
 *   - the events that fired AND resolved while away, which the ranked list
 *     omits by construction and which are precisely what "you missed" means
 */

/** How many entries the spine carries before it stops being a summary. */
const MAX_CHRONOLOGY = 8

/**
 * Session time for a move, from 15-minute bars.
 *
 * This is the only thing intraday data is used for, and the reason it is kept
 * at fifteen minutes rather than hourly: "between 10:00 and 11:00" carries the
 * same information as "in the morning" and cannot separate a headline from the
 * move that followed it.
 *
 * Null is the normal answer for anything older than the retention window, and
 * the caller renders the date alone rather than inventing a time.
 */
async function timeOfLargestMove(
  instrumentId: string,
  date: string,
): Promise<string | null> {
  const bars = await db.intradayBar.findMany({
    where: {
      instrumentId,
      at: {
        gte: new Date(`${date}T00:00:00Z`),
        lt: new Date(`${date}T23:59:59Z`),
      },
    },
    orderBy: { at: 'asc' },
    select: { at: true, open: true, close: true },
  })

  if (bars.length < 2) return null

  let worst = 0
  let worstAt: Date | null = null
  for (const b of bars) {
    if (!(b.open > 0)) continue
    const move = Math.abs(b.close / b.open - 1)
    if (move > worst) {
      worst = move
      worstAt = b.at
    }
  }
  if (!worstAt) return null

  const minutes = nyMinutes(worstAt)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Morning, midday, afternoon — how a person would actually say it. */
export function sessionPhrase(time: string | null): string | null {
  if (!time) return null
  const [h] = time.split(':').map(Number)
  if (h < 11) return 'in the morning'
  if (h < 14) return 'around midday'
  return 'in the afternoon'
}

export async function buildChronology(
  instrumentIds: string[],
  since: Date | null,
): Promise<ChronologyEntry[]> {
  if (!since || instrumentIds.length === 0) return []

  const events = await db.event.findMany({
    where: {
      instrumentId: { in: instrumentIds },
      scenarioId: null,
      marketTime: { gt: since },
      severity: { in: ['CRITICAL', 'IMPORTANT'] },
    },
    orderBy: [{ score: 'desc' }],
    take: 40,
    include: { instrument: { select: { symbol: true } }, theme: true },
  })

  // One entry per instrument-day: several detectors firing on the same name on
  // the same day is one thing happening, not four.
  const seen = new Set<string>()
  const entries: ChronologyEntry[] = []

  for (const e of events) {
    const date = e.marketTime.toISOString().slice(0, 10)
    const key = `${e.instrumentId}:${date}`
    if (seen.has(key)) continue
    seen.add(key)

    const time = await timeOfLargestMove(e.instrumentId, date)

    entries.push({
      date,
      timeOfDay: time,
      kind: 'move',
      symbol: e.instrument.symbol,
      text: e.headline,
    })

    if (entries.length >= MAX_CHRONOLOGY) break
  }

  // Themes are a distinct kind of thing happening, and worth their own line:
  // "these names moved together" is a different statement from any one of
  // their moves.
  const themes = await db.theme.findMany({
    where: { scenarioId: null, windowStart: { gt: since } },
    orderBy: { confidence: 'desc' },
    take: 3,
  })

  for (const t of themes) {
    entries.push({
      date: t.windowStart.toISOString().slice(0, 10),
      timeOfDay: null,
      kind: 'theme',
      symbol: null,
      text: `${t.scopeKey} moved together — ${t.memberCount} names, ${Math.round(t.confidence)}% confidence`,
    })
  }

  const earnings = await db.earningsEvent.findMany({
    where: {
      instrumentId: { in: instrumentIds },
      reportDate: { gt: since, lte: new Date() },
    },
    orderBy: { reportDate: 'asc' },
    take: 4,
    include: { instrument: { select: { symbol: true } } },
  })

  for (const e of earnings) {
    entries.push({
      date: e.reportDate.toISOString().slice(0, 10),
      timeOfDay: null,
      kind: 'earnings',
      symbol: e.instrument.symbol,
      text: `${e.instrument.symbol} reported earnings`,
    })
  }

  // Chronological, because that is the whole point of the section.
  return entries
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, MAX_CHRONOLOGY)
}

/**
 * Events that fired and resolved during the absence.
 *
 * These never reach the ranked list: an event whose conditions no longer hold
 * is not "what matters now", so ranking drops it. But it is exactly what a
 * user means by "what did I miss" — the thing that happened and finished while
 * they were not looking. Omitting it silently is the failure this closes.
 */
export async function findCameAndWent(
  instrumentIds: string[],
  since: Date | null,
  stillSurfacedSymbols: string[],
): Promise<Array<{ symbol: string; headline: string; date: string }>> {
  if (!since || instrumentIds.length === 0) return []

  const surfaced = new Set(stillSurfacedSymbols)

  const events = await db.event.findMany({
    where: {
      instrumentId: { in: instrumentIds },
      scenarioId: null,
      marketTime: { gt: since },
      severity: { in: ['CRITICAL', 'IMPORTANT'] },
    },
    orderBy: [{ score: 'desc' }],
    take: 30,
    include: { instrument: { select: { symbol: true } } },
  })

  const out: Array<{ symbol: string; headline: string; date: string }> = []
  const seen = new Set<string>()

  for (const e of events) {
    const symbol = e.instrument.symbol
    // Still on the brief means it did not "come and go".
    if (surfaced.has(symbol) || seen.has(symbol)) continue
    seen.add(symbol)

    out.push({
      symbol,
      headline: e.headline,
      date: e.marketTime.toISOString().slice(0, 10),
    })
    if (out.length >= 4) break
  }

  return out
}
