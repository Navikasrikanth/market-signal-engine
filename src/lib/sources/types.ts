/**
 * One interface per data concern, so a provider can be swapped or added without
 * touching ingestion. Reconciliation compares the output of two `BarSource`
 * implementations for the same symbol/date and resolves by `trustRank`.
 */

export interface RawBar {
  /** `YYYY-MM-DD`, market date. */
  date: string
  open: number
  high: number
  low: number
  close: number
  /** Adjusted close if the provider supplies one, else `close`. */
  closeAdj: number
  volume: number
}

export interface FetchBarsOptions {
  /** Inclusive `YYYY-MM-DD`. */
  from?: string
  /** Inclusive `YYYY-MM-DD`. */
  to?: string
}

export interface BarSource {
  /** Stable id matching `DataSource.id` in the database. */
  readonly id: string
  /** Lower wins when two sources disagree within tolerance. */
  readonly trustRank: number
  fetchDailyBars(symbol: string, opts?: FetchBarsOptions): Promise<RawBar[]>
}

/** A 15-minute bar. Chronology only — never an analytical input. */
export interface RawIntradayBar {
  /** Bar open time, ISO 8601 UTC. */
  at: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface IntradaySource {
  readonly id: string
  fetchIntradayBars(symbol: string, days: number): Promise<RawIntradayBar[]>
}

/** One headline. Attaches to events; never creates one. */
export interface RawNews {
  publishedAt: string
  headline: string
  source: string
  url: string
  summary: string | null
}

export interface NewsSource {
  readonly id: string
  fetchNews(symbol: string, from: string, to: string): Promise<RawNews[]>
}

export interface RawEarnings {
  symbol: string
  /** `YYYY-MM-DD` */
  reportDate: string
  /** "bmo" before open, "amc" after close, null if unknown. */
  session: string | null
  epsEstimate: number | null
  epsActual: number | null
}

export interface EarningsSource {
  readonly id: string
  fetchEarnings(symbols: string[], from: string, to: string): Promise<RawEarnings[]>
}

/** Thrown when a provider responds but the payload is unusable. */
export class SourceDataError extends Error {
  constructor(
    public readonly sourceId: string,
    public readonly symbol: string,
    message: string,
  ) {
    super(`[${sourceId}:${symbol}] ${message}`)
    this.name = 'SourceDataError'
  }
}
