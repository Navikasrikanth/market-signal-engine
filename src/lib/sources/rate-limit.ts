/**
 * A token bucket, per provider.
 *
 * The plan claimed each source had one. None did — and the gap only became
 * visible on the first live run, where the intraday job walked 26 symbols as
 * fast as it could, hit Twelve Data's 8-per-minute ceiling after eight, and
 * stored data for **eight of twenty-six** while logging four 429s and calling
 * itself done. Per-symbol error handling meant it degraded instead of dying,
 * which is right, but "degraded" hid the fact that two thirds of the universe
 * was silently missing.
 *
 * The limit belongs to the provider rather than to whoever is calling it: a
 * bucket held by the caller has to be remembered at every call site, and the
 * one that forgets is the one that breaks. So the source itself waits.
 */

export interface RateLimitOptions {
  /** Requests permitted per window. */
  capacity: number
  /** Window length in milliseconds. */
  windowMs: number
  /**
   * Whether to allow an initial burst up to capacity.
   *
   * Default false, and that default was earned. A classic token bucket starts
   * full, which lets the first `capacity` requests fire instantly — perfectly
   * correct for an average-rate limit, and wrong for a ROLLING-WINDOW one. On
   * a live run the burst put eight requests into the first second, so the
   * ninth breached "8 per minute" seven seconds later and four symbols came
   * back 429 even with nothing else running.
   *
   * Starting empty spaces every request evenly. It costs one interval at
   * start-up and removes the entire class of failure.
   */
  allowBurst?: boolean
}

export class TokenBucket {
  private tokens: number
  private lastRefill: number

  constructor(private readonly options: RateLimitOptions) {
    this.tokens = options.allowBurst ? options.capacity : 0
    this.lastRefill = Date.now()
  }

  private refill(now: number): void {
    const elapsed = now - this.lastRefill
    if (elapsed <= 0) return

    const refillRate = this.options.capacity / this.options.windowMs
    this.tokens = Math.min(
      this.options.capacity,
      this.tokens + elapsed * refillRate,
    )
    this.lastRefill = now
  }

  /** Milliseconds until a token is available. Zero when one is ready now. */
  waitMs(now = Date.now()): number {
    this.refill(now)
    if (this.tokens >= 1) return 0

    const refillRate = this.options.capacity / this.options.windowMs
    return Math.ceil((1 - this.tokens) / refillRate)
  }

  /**
   * Block until a token is free, then consume it.
   *
   * Waiting is deliberately preferred to failing. A 429 costs the request AND
   * the data; a pause costs only time, and every caller here runs on a
   * schedule with minutes of headroom.
   */
  async take(): Promise<void> {
    for (;;) {
      const wait = this.waitMs()
      if (wait === 0) {
        this.tokens -= 1
        return
      }
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
}

/**
 * Twelve Data free tier: 8 credits per minute, and a credit is charged PER
 * SYMBOL rather than per request — a 26-symbol batch call returns
 * `429: 26 API credits were used, limit 8`.
 */
export const twelveDataBucket = new TokenBucket({
  capacity: 8,
  windowMs: 60_000,
})

/**
 * One caveat worth stating plainly: this bucket is per PROCESS.
 *
 * The product has exactly one process making provider calls — the worker, at
 * ingest concurrency 1 — so a single bucket is sufficient. Running a second
 * fetcher alongside it doubles the real request rate while each believes it is
 * within budget, which is precisely what happened when a debugging script ran
 * beside the worker. If provider I/O ever moves to more than one process, this
 * has to become a Redis-backed counter; the lock in `queue.ts` is the obvious
 * place to put it.
 */

/** Tiingo free tier: 50 requests/hour. Far tighter, so paced accordingly. */
export const tiingoBucket = new TokenBucket({
  capacity: 50,
  windowMs: 60 * 60_000,
})
