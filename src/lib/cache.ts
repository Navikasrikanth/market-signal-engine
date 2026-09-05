import Redis from 'ioredis'
import { ENGINE_VERSION } from '@/engine/types'

/**
 * Cache-aside, and never a dependency.
 *
 * Redis was previously used only as a queue backend, deliberately kept off the
 * read path on the grounds that a queue which can take the product offline is
 * worse than no queue. That reasoning still holds — so the cache is written so
 * that losing Redis costs latency and nothing else. Every read falls through to
 * Postgres on a miss, on an error, and on a timeout, and the brief renders
 * identically either way. A test asserts exactly that.
 *
 * Correctness comes from GENERATION invalidation, not from TTL. Keys carry the
 * engine version and a generation counter bumped whenever compute finishes, so
 * a recompute cannot leave a stale entry reachable. TTL exists only so that
 * superseded generations do not accumulate forever — it is garbage collection,
 * and if it were the correctness mechanism the product would be serving
 * whatever happened to be within its expiry window.
 */

const PREFIX = 'sitrep:cache'
const GENERATION_KEY = `${PREFIX}:generation`

/** Bounded so a slow cache never becomes slower than not having one. */
const TIMEOUT_MS = 250

/**
 * Garbage-collection lifetimes, not correctness windows.
 *
 * Chosen so that a superseded generation's keys disappear on their own within
 * an hour or so. Anything that must be right the moment it changes is handled
 * by invalidation, not by picking a smaller number here.
 */
export const TTL = {
  /**
   * A user's assembled brief. Dropped explicitly on mark-seen, snooze, a
   * watchlist edit, and sign-in — every change the user can themselves cause.
   */
  sitrep: 15 * 60,
  /** Per-instrument window statistics — the real O(watchlist) cost. */
  windowStats: 60 * 60,
  /** Detector scorecard, on /performance. Changes only when compute runs. */
  scorecard: 60 * 60,
} as const

// Entries for market context and the latest intraday observation were removed
// rather than left declared and unused. Both are assembled inside the brief,
// so caching them separately would have been a second copy of the same data
// with its own expiry - and a declared-but-unread constant is the same class
// of quiet lie as a documented-but-unimplemented flag.

let client: Redis | null = null
let disabled = process.env.CACHE_DISABLED === '1'

/** Counters for the ops page. A cache nobody can measure is a liability. */
const stats = { hits: 0, misses: 0, errors: 0 }

function connection(): Redis | null {
  if (disabled) return null
  // An open breaker means the last few calls all timed out. Skipping outright
  // turns an outage into one delay rather than twenty.
  if (breakerOpen()) return null
  if (client) return client

  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380', {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: true,
    // Never retry forever on the read path.
    connectTimeout: 1_000,
    lazyConnect: true,
  })

  // Do not hold the process open.
  //
  // An open Redis socket keeps the Node event loop alive, so every script that
  // touched the cache - seed, compute, calibrate - stopped exiting the moment
  // caching was introduced. Unreferencing the socket means a forgotten
  // `closeCache()` costs nothing rather than hanging a build step forever.
  redis.once('ready', () => redis.stream?.unref?.())
  redis.on('error', () => {
    // Connection trouble is a cache miss, not an unhandled rejection.
    stats.errors++
  })
  redis.connect().catch(() => {})

  client = redis
  return client
}

/**
 * A breaker, so an outage costs one timeout rather than one per call.
 *
 * Every cache read is individually bounded at 250ms, which is correct and was
 * not enough: assembling a brief makes roughly twenty cache calls, so with
 * Redis unreachable the page took **5.1 seconds** to render the same answer
 * Postgres could give immediately. Bounded, but linearly in the number of
 * calls - which is the shape of an outage being paid for repeatedly.
 *
 * After a run of failures the cache is skipped outright for a cool-off period.
 * It reopens on its own, so recovery needs no intervention.
 */
const BREAKER_THRESHOLD = 3
const BREAKER_COOLOFF_MS = 30_000

let consecutiveFailures = 0
let breakerOpenUntil = 0

function breakerOpen(): boolean {
  if (breakerOpenUntil === 0) return false
  if (Date.now() < breakerOpenUntil) return true
  // Cool-off elapsed: let one request through and see.
  breakerOpenUntil = 0
  consecutiveFailures = 0
  return false
}

function recordFailure(): void {
  consecutiveFailures++
  if (consecutiveFailures >= BREAKER_THRESHOLD) {
    breakerOpenUntil = Date.now() + BREAKER_COOLOFF_MS
  }
}

function recordSuccess(): void {
  consecutiveFailures = 0
  breakerOpenUntil = 0
}

async function bounded<T>(op: Promise<T>, fallback: T): Promise<T> {
  try {
    let timedOut = false
    const result = await Promise.race([
      op,
      new Promise<T>((resolve) =>
        setTimeout(() => {
          timedOut = true
          resolve(fallback)
        }, TIMEOUT_MS),
      ),
    ])
    if (timedOut) {
      stats.errors++
      recordFailure()
    } else {
      recordSuccess()
    }
    return result
  } catch {
    stats.errors++
    recordFailure()
    return fallback
  }
}

/**
 * The current generation.
 *
 * Every cached key embeds it, so bumping it retires the entire cache at once
 * without deleting anything — which matters because SCAN-and-delete over a
 * live keyspace is exactly the kind of operation that turns a cache outage
 * into a database outage.
 */
export async function generation(): Promise<number> {
  const redis = connection()
  if (!redis) return 0
  const raw = await bounded(redis.get(GENERATION_KEY), null)
  return raw ? Number(raw) : 0
}

/** Retire every cached value. Called when compute finishes. */
export async function bumpGeneration(): Promise<number> {
  const redis = connection()
  if (!redis) return 0
  const next = await bounded(redis.incr(GENERATION_KEY), 0)
  return next
}

function keyFor(namespace: string, id: string, gen: number): string {
  // Engine version is in the key as well as the generation: a code change that
  // alters what a value MEANS must not be able to read an entry written by the
  // previous engine, even within the same generation.
  return `${PREFIX}:${ENGINE_VERSION}:${gen}:${namespace}:${id}`
}

/**
 * Read through the cache, computing on a miss.
 *
 * `compute` is always the source of truth. Anything that goes wrong with the
 * cache — miss, timeout, connection failure, malformed JSON — resolves to
 * calling it, so the worst outcome is the performance of not having a cache.
 */
export async function cached<T>(
  namespace: string,
  id: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
): Promise<T> {
  const redis = connection()
  if (!redis) return compute()

  const gen = await generation()
  const key = keyFor(namespace, id, gen)

  const hit = await bounded(redis.get(key), null)
  if (hit) {
    try {
      stats.hits++
      return JSON.parse(hit, reviveDates) as T
    } catch {
      // A malformed entry is a miss, not an error worth surfacing.
      stats.errors++
    }
  } else {
    stats.misses++
  }

  const value = await compute()

  // Write-behind: a failed write must not fail the request that computed a
  // perfectly good answer.
  void bounded(
    redis.set(key, JSON.stringify(value), 'EX', ttlSeconds),
    null,
  ).catch(() => {})

  return value
}

/** Drop one user's cached brief — on mark-seen, snooze, or a watchlist edit. */
export async function invalidateUser(userId: string): Promise<void> {
  const redis = connection()
  if (!redis) return
  const gen = await generation()
  await bounded(redis.del(keyFor('sitrep', userId, gen)), 0)
}

export function cacheStats(): {
  hits: number
  misses: number
  errors: number
  hitRate: number | null
  enabled: boolean
  /** True while the cache is being skipped after repeated failures. */
  breakerOpen: boolean
} {
  const total = stats.hits + stats.misses
  return {
    ...stats,
    hitRate: total > 0 ? stats.hits / total : null,
    enabled: !disabled,
    breakerOpen: breakerOpenUntil > Date.now(),
  }
}

/** For tests: prove the answer is identical with the cache switched off. */
export function setCacheDisabled(value: boolean): void {
  disabled = value
}

export async function closeCache(): Promise<void> {
  // `disconnect`, not `quit`.
  //
  // `quit` is graceful: it waits for pending commands and for the connection
  // to be established before closing. On a client that never connected - which
  // is exactly the case when Redis is unreachable - it never resolves, and the
  // process hangs at exit with every check already passed. `disconnect` tears
  // the socket down immediately, which is the correct behaviour for shutdown.
  client?.disconnect()
  client = null
  // A reconnect deserves a fresh assessment rather than inheriting a breaker
  // opened against the previous endpoint.
  consecutiveFailures = 0
  breakerOpenUntil = 0
}

/**
 * JSON has no date type, so a cached `Date` would come back as a string and
 * silently change the shape of the value. Anything matching an ISO timestamp
 * is revived.
 */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

function reviveDates(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && ISO.test(value)) return new Date(value)
  return value
}
