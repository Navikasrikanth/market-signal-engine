import { createHash } from 'node:crypto'
import type {
  EarningsSource,
  NewsSource,
  RawEarnings,
  RawNews,
} from './types'
import { SourceDataError } from './types'

/**
 * Finnhub — company news and the forward earnings calendar.
 *
 * Two hard limits, both verified rather than assumed, and both shaping the
 * design rather than being worked around:
 *
 * 1. `/stock/candle` is paid. Bars come from Twelve Data and Tiingo instead.
 *
 * 2. Company news is effectively live-only. A request returns roughly the most
 *    recent 250 articles before `to` — for a liquid name that is about TWO
 *    DAYS — and a January 2025 window returns nothing at all. So news can
 *    never appear in historical replay, and cannot be backfilled into
 *    fixtures. The replay page says so rather than letting the absence read as
 *    a bug.
 *
 * A third fact shapes the ranking: 249 articles for one ticker over two days
 * came from FIVE distinct outlets. Article volume measures syndication, not
 * importance. Counting distinct outlets is the only signal of significance
 * this data honestly supports.
 */

/** Articles kept per symbol per day, after collapsing syndicated copies. */
const MAX_PER_SYMBOL = 10

export class FinnhubSource implements NewsSource, EarningsSource {
  readonly id = 'finnhub'

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error('FINNHUB_API_KEY is not set')
  }

  async fetchNews(symbol: string, from: string, to: string): Promise<RawNews[]> {
    const url = new URL('https://finnhub.io/api/v1/company-news')
    url.searchParams.set('symbol', symbol)
    url.searchParams.set('from', from)
    url.searchParams.set('to', to)
    url.searchParams.set('token', this.apiKey)

    const res = await fetch(url)
    if (!res.ok) {
      throw new SourceDataError(this.id, symbol, `HTTP ${res.status}`)
    }

    const body = (await res.json()) as FinnhubArticle[]
    if (!Array.isArray(body)) {
      throw new SourceDataError(this.id, symbol, 'unexpected payload')
    }

    return body
      .filter((a) => a.headline && a.url && Number.isFinite(a.datetime))
      .map((a) => ({
        publishedAt: new Date(a.datetime * 1000).toISOString(),
        headline: a.headline.trim(),
        source: (a.source ?? 'unknown').trim(),
        url: a.url,
        summary: a.summary?.trim() || null,
      }))
  }

  async fetchEarnings(
    symbols: string[],
    from: string,
    to: string,
  ): Promise<RawEarnings[]> {
    const url = new URL('https://finnhub.io/api/v1/calendar/earnings')
    url.searchParams.set('from', from)
    url.searchParams.set('to', to)
    url.searchParams.set('token', this.apiKey)

    const res = await fetch(url)
    if (!res.ok) {
      throw new SourceDataError(this.id, symbols[0] ?? '*', `HTTP ${res.status}`)
    }

    const body = (await res.json()) as {
      earningsCalendar?: FinnhubEarningsRow[]
    }
    const wanted = new Set(symbols)

    return (body.earningsCalendar ?? [])
      .filter((r) => wanted.has(r.symbol))
      .map((r) => ({
        symbol: r.symbol,
        reportDate: r.date,
        session: r.hour ?? null,
        epsEstimate: r.epsEstimate ?? null,
        epsActual: r.epsActual ?? null,
      }))
  }
}

interface FinnhubArticle {
  datetime: number
  headline: string
  source?: string
  summary?: string
  url: string
}

interface FinnhubEarningsRow {
  symbol: string
  date: string
  hour?: string | null
  epsEstimate?: number | null
  epsActual?: number | null
}

// ---------------------------------------------------------------- ranking

export interface RankedNews extends RawNews {
  /** Distinct outlets carrying a near-identical headline. */
  corroboration: number
  fingerprint: string
}

/**
 * Normalise a headline down to what it is actually saying.
 *
 * Syndicated copies differ in punctuation, casing, ticker suffixes and
 * trailing outlet names while reporting the same thing. Reducing to lowercase
 * alphanumeric words and dropping the short ones collapses them onto the same
 * key without needing a similarity model.
 */
export function headlineKey(headline: string): string {
  const words = headline
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .sort()
  return words.join(' ')
}

export function newsFingerprint(symbol: string, headline: string, day: string): string {
  return createHash('sha256')
    .update(`${symbol}|${day}|${headlineKey(headline)}`)
    .digest('hex')
    .slice(0, 32)
}

/**
 * Is this article actually about the company?
 *
 * It has to be asked, because the provider's tagging is extremely loose. Of
 * 255 articles pulled across the universe on a live run, **51 mentioned the
 * company they were filed under**. The rest were aggregator listicles —
 * "Weekly Wrap: Bitcoin's Win Streak Continues" and "Vertex vs. Regeneron:
 * Which Biotech Giant Is the Better Buy" both arrived tagged NVDA.
 *
 * Putting those under a card that explains an NVDA volume spike would assert a
 * relationship that does not exist. Unrelated context presented as context is
 * worse than no context, so the bar is simply: the headline has to name the
 * company or its ticker.
 *
 * The ticker is matched on a word boundary. Without it "MU" matches "MUCH",
 * "AMD" matches "AMDOCS", and the filter quietly stops filtering.
 */
export function mentionsCompany(
  headline: string,
  symbol: string,
  companyName: string,
): boolean {
  if (new RegExp(`\\b${symbol}\\b`, 'i').test(headline)) return true

  if (!companyName) return false

  // First meaningful word of the registered name: "NVIDIA Corporation" ->
  // "nvidia", "Advanced Micro Devices" -> "advanced". Legal suffixes and
  // single letters carry no signal.
  const word = companyName
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ''))
    .find((w) => w.length > 3)

  if (!word) return false
  return new RegExp(`\\b${word}\\b`, 'i').test(headline)
}

/**
 * Collapse syndicated copies and rank what remains.
 *
 * The ranking rule is the whole design: **a story carried by four outlets
 * outranks one outlet posting it forty times.** Ranking by article count would
 * promote whichever wire service is most prolific, which is a fact about
 * publishing, not about the company.
 */
export function rankNews(
  symbol: string,
  /**
   * Required, not optional. As an optional trailing argument it silently
   * weakened the relevance filter for any caller that forgot it — the same
   * footgun as a flag that is documented and unread.
   */
  companyName: string,
  articles: RawNews[],
  limit = MAX_PER_SYMBOL,
): RankedNews[] {
  const groups = new Map<
    string,
    { article: RawNews; outlets: Set<string>; fingerprint: string }
  >()

  for (const a of articles) {
    // Four fifths of what the provider returns is not about this company.
    if (!mentionsCompany(a.headline, symbol, companyName)) continue

    const day = a.publishedAt.slice(0, 10)
    const fingerprint = newsFingerprint(symbol, a.headline, day)

    const existing = groups.get(fingerprint)
    if (existing) {
      existing.outlets.add(a.source)
      // Keep the earliest telling: the first outlet to carry a story is more
      // informative than the twentieth to repeat it.
      if (a.publishedAt < existing.article.publishedAt) existing.article = a
    } else {
      groups.set(fingerprint, {
        article: a,
        outlets: new Set([a.source]),
        fingerprint,
      })
    }
  }

  return [...groups.values()]
    .map((g) => ({
      ...g.article,
      corroboration: g.outlets.size,
      fingerprint: g.fingerprint,
    }))
    .sort(
      (a, b) =>
        b.corroboration - a.corroboration ||
        b.publishedAt.localeCompare(a.publishedAt),
    )
    .slice(0, limit)
}
