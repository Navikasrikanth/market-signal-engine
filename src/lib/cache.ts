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
  /** A user's assembled brief. Dropped explicitly on mark-seen and snooze. */
  sitrep: 15 * 60,
  /** Per-instrument window statistics — the real O(watchlist) cost. */
  windowStats: 60 * 60,
  /** Detector scorecard. Changes only when compute runs. */
  scorecard: 60 * 60,
  /** Market context for the brief header. */
  marketContext: 15 * 60,
  /** Latest intraday observation. Not a live price; see the README. */
  intraday: 5 * 60,
} as const

let client: Redis | null = null
let disabled = process.env.CACHE_DISABLED === '1'

/** Counters for the ops page. A cache nobody can measure is a liability. */
const stats = { hits: 0, misses: 0, errors: 0 }

function connection(): Redis | null {
  if (disabled) return null
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

async function bounded<T>(op: Promise<T>, fallback: T): Promise<T> {
  try {
    return await Promise.race([
      op,
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), TIMEOUT_MS)),
    ])
  } catch {
    stats.errors++
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
} {
  const total = stats.hits + stats.misses
  return {
    ...stats,
    hitRate: total > 0 ? stats.hits / total : null,
    enabled: !disabled,
  }
}

/** For tests: prove the answer is identical with the cache switched off. */
export function setCacheDisabled(value: boolean): void {
  disabled = value
}

export async function closeCache(): Promise<void> {
  await client?.quit().catch(() => {})
  client = null
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
