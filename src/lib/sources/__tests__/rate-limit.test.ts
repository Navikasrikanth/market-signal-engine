import { describe, expect, it } from 'vitest'
import { TokenBucket } from '../rate-limit'

/**
 * The bucket exists because of a real failure: without it the intraday job
 * walked 26 symbols at full speed, hit an 8-per-minute ceiling after eight,
 * and stored data for eight of twenty-six while reporting success.
 */

describe('TokenBucket', () => {
  it('does NOT burst by default', () => {
    // The default that was earned the hard way. A bucket starting full puts
    // `capacity` requests into the first second, so the next one breaches a
    // rolling-window limit even though the average rate is fine — four
    // symbols came back 429 on a live run with nothing else competing.
    const bucket = new TokenBucket({ capacity: 8, windowMs: 60_000 })
    expect(bucket.waitMs()).toBeGreaterThan(0)
  })

  it('allows a burst only when explicitly asked', () => {
    const bucket = new TokenBucket({
      capacity: 8,
      windowMs: 60_000,
      allowBurst: true,
    })
    expect(bucket.waitMs()).toBe(0)
  })

  it('makes the caller wait once the burst is spent', async () => {
    const bucket = new TokenBucket({
      capacity: 2,
      windowMs: 1_000,
      allowBurst: true,
    })
    await bucket.take()
    await bucket.take()

    // The ninth call in the real case is the one that produced a 429.
    expect(bucket.waitMs()).toBeGreaterThan(0)
  })

  it('refills over time rather than all at once', () => {
    const bucket = new TokenBucket({
      capacity: 8,
      windowMs: 60_000,
      allowBurst: true,
    })
    const start = Date.now()
    for (let i = 0; i < 8; i++) void bucket.take()

    // Half a window later, roughly half the capacity is back — a bucket that
    // refilled only at window boundaries would idle for a full minute and then
    // burst, which is exactly the pattern that trips a rolling limit.
    expect(bucket.waitMs(start + 30_000)).toBe(0)
  })

  it('actually paces, end to end', async () => {
    // Four tokens per 200ms; six calls must therefore take at least one refill.
    const bucket = new TokenBucket({ capacity: 4, windowMs: 200, allowBurst: true })
    const began = Date.now()
    for (let i = 0; i < 6; i++) await bucket.take()
    expect(Date.now() - began).toBeGreaterThanOrEqual(80)
  })
})
