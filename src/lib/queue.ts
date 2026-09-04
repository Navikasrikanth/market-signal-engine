import { Queue, type ConnectionOptions } from 'bullmq'
import Redis from 'ioredis'

/**
 * The job queue.
 *
 * Ingestion and compute are asynchronous for reasons that are real even at this
 * size, not aspirational:
 *
 *   - a provider call can take seconds and must not block an HTTP response
 *   - the free tiers rate-limit by the hour, so work has to be paced and
 *     resumed rather than retried in a tight loop
 *   - compute is per-instrument and independent, so it parallelises trivially
 *   - a failed symbol must not abandon the other 25
 *
 * Every job is keyed by its natural identity (`ingest:AAPL:2026-09-04`), so
 * BullMQ deduplicates a double-enqueue and a retry re-runs an idempotent
 * upsert rather than duplicating rows.
 */

export const QUEUE_NAMES = {
  ingest: 'sitrep-ingest',
  compute: 'sitrep-compute',
  /** Intraday bars, news, earnings, and housekeeping. */
  auxiliary: 'sitrep-aux',
} as const

export function redisConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6380'
  const parsed = new URL(url)
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    // BullMQ requires this; without it a stalled job is retried forever.
    maxRetriesPerRequest: null,
  }
}

export interface IngestJob {
  symbol: string
  from?: string
  to?: string
}

export interface ComputeJob {
  /** Omit to recompute the whole universe. */
  symbol?: string
  from?: string
  replace?: boolean
}

/**
 * Everything that is not a daily bar or a recompute.
 *
 * One queue rather than four: these differ in cadence, not in shape, and four
 * near-empty queues would be four things to watch on the ops page for no gain.
 */
export type AuxKind = 'intraday' | 'news' | 'earnings' | 'maintenance'

export interface AuxJob {
  kind: AuxKind
  symbols?: string[]
}

let ingestQueue: Queue<IngestJob> | null = null
let computeQueue: Queue<ComputeJob> | null = null

export function getIngestQueue(): Queue<IngestJob> {
  ingestQueue ??= new Queue<IngestJob>(QUEUE_NAMES.ingest, {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 3,
      // Long backoff on purpose: the failure we actually hit is an hourly rate
      // limit, and hammering it costs quota without ever succeeding.
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 100 },
    },
  })
  return ingestQueue
}

export function getComputeQueue(): Queue<ComputeJob> {
  computeQueue ??= new Queue<ComputeJob>(QUEUE_NAMES.compute, {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 100 },
    },
  })
  return computeQueue
}

let auxQueue: Queue<AuxJob> | null = null

export function getAuxQueue(): Queue<AuxJob> {
  auxQueue ??= new Queue<AuxJob>(QUEUE_NAMES.auxiliary, {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  })
  return auxQueue
}

/**
 * Single-flight: only one holder of a named lock at a time.
 *
 * Job ids already deduplicate identical work, but they do not stop an ingest
 * cycle starting while the previous one is still running — a 15-minute
 * schedule against a slow provider run will overlap eventually, and two cycles
 * racing spend provider quota twice for one result.
 *
 * The database stays correct either way (writes are idempotent upserts); this
 * is about not paying for the same data twice. Fails OPEN: if Redis cannot be
 * reached the work proceeds unguarded rather than stopping, because a missing
 * lock server must not silently halt ingestion.
 */
let lock: Redis | null = null

/** How long to wait for the lock server before proceeding unguarded. */
const LOCK_TIMEOUT_MS = 2_000

/** A plain Redis connection, used only for locks. */
function lockClient(): Redis {
  if (lock) return lock

  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380', {
    maxRetriesPerRequest: 1,
    // Commands issued before the socket is ready are QUEUED, not rejected.
    //
    // With the queue disabled they threw instead, and the fail-open path then
    // let every caller through - so on a cold client the lock did not engage
    // at all and two ingestion cycles ran side by side. The timeout below is
    // what bounds the wait; refusing to buffer was never the right guard.
    enableOfflineQueue: true,
    lazyConnect: true,
  })
  // Same reason as the cache client: an open socket keeps scripts alive.
  redis.once('ready', () => redis.stream?.unref?.())
  redis.on('error', () => {})
  redis.connect().catch(() => {})

  lock = redis
  return lock
}

export async function withLock<T>(
  name: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const client = lockClient()
  const key = `sitrep:lock:${name}`
  const token = Math.random().toString(36).slice(2)

  let acquired = false
  try {
    // Bounded: a lock server that is merely slow must not hold up ingestion,
    // and one that is absent must not stop it. Both resolve to "proceed
    // unguarded", which risks paying twice for data rather than not having it.
    const result = await Promise.race([
      client.set(key, token, 'EX', ttlSeconds, 'NX'),
      new Promise<'TIMEOUT'>((resolve) =>
        setTimeout(() => resolve('TIMEOUT'), LOCK_TIMEOUT_MS),
      ),
    ])
    if (result === 'TIMEOUT') return fn()
    acquired = result === 'OK'
  } catch {
    // No lock server. Proceed rather than stall.
    return fn()
  }

  if (!acquired) return null

  try {
    return await fn()
  } finally {
    try {
      // Release only our own lock: a slow run whose TTL expired must not
      // delete the lock a successor already holds.
      const current = await client.get(key)
      if (current === token) await client.del(key)
    } catch {
      // TTL will clear it.
    }
  }
}

/** Queue depth per state, for the ops dashboard. */
export async function queueDepths() {
  try {
    const [ingest, compute, aux] = await Promise.all([
      getIngestQueue().getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      getComputeQueue().getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      getAuxQueue().getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
    ])
    return { ingest, compute, aux, reachable: true as const }
  } catch {
    // The app must render without Redis. The queue accelerates ingestion; it is
    // not on the read path, and the ops page should say so rather than 500.
    return { ingest: null, compute: null, aux: null, reachable: false as const }
  }
}

export async function closeQueues() {
  await Promise.all([ingestQueue?.close(), computeQueue?.close(), auxQueue?.close()])
  ingestQueue = null
  computeQueue = null
  auxQueue = null
  await lock?.quit().catch(() => {})
  lock = null
}
