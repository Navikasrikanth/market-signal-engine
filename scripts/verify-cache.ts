import 'dotenv/config'
import { db } from '../src/lib/db'
import { buildSitrep, markSeen } from '../src/lib/sitrep'
import {
  bumpGeneration,
  cacheStats,
  closeCache,
  generation,
  invalidateUser,
  setCacheDisabled,
} from '../src/lib/cache'

/**
 * The cache must not be able to change an answer.
 *
 * That is the whole claim, and it is worth more than any hit-rate number: a
 * cache that returns something different from the database is not an
 * optimisation, it is a bug with better latency. Everything here compares the
 * two paths rather than measuring speed.
 */

let passed = 0
let failed = 0

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/** Compare briefs structurally; `since` is a Date and JSON-round-trips. */
function fingerprint(sitrep: Awaited<ReturnType<typeof buildSitrep>>): string {
  return JSON.stringify({
    items: sitrep.items.map((i) => [i.symbol, i.attentionScore, i.severity, i.headline]),
    budget: sitrep.budget,
    withinNormalRange: sitrep.withinNormalRange,
    belowBudget: sitrep.belowBudget,
    snoozed: sitrep.snoozedCount,
    narrative: sitrep.narrative.ruleId,
    since: sitrep.since?.toISOString() ?? null,
    quality: sitrep.dataQuality,
  })
}

async function main() {
  const user = await db.user.findUniqueOrThrow({
    where: { email: 'demo@sitrep.local' },
  })

  // ------------------------------------------------------------------- 1
  console.log('\n[1] The cache cannot change the answer')

  setCacheDisabled(true)
  const withoutCache = fingerprint(await buildSitrep(user.id))

  setCacheDisabled(false)
  await invalidateUser(user.id)
  const cold = fingerprint(await buildSitrep(user.id))
  const warm = fingerprint(await buildSitrep(user.id))

  check('a cold cache matches the database', cold === withoutCache)
  check('a warm cache matches the database', warm === withoutCache)
  check(
    'and the second read actually hit the cache',
    cacheStats().hits > 0,
    `${cacheStats().hits} hits, ${cacheStats().misses} misses`,
  )

  // ------------------------------------------------------------------- 2
  console.log('\n[2] Generation invalidation retires everything at once')

  const before = await generation()
  const after = await bumpGeneration()

  check('bumping the generation advances it', after === before + 1)

  const afterBump = fingerprint(await buildSitrep(user.id))
  check(
    'reads after a bump still return the right answer',
    afterBump === withoutCache,
    'old entries become unreachable rather than being deleted',
  )

  // ------------------------------------------------------------------- 3
  console.log('\n[3] A write the user can see invalidates their brief')

  const sitrep = await buildSitrep(user.id)
  const top = sitrep.items[0]

  if (!top) {
    check('demo state has something to acknowledge', false)
  } else {
    const instrument = await db.instrument.findUniqueOrThrow({
      where: { symbol: top.symbol },
    })
    await markSeen(user.id, [instrument.id], top.eventIds)

    const afterSeen = await buildSitrep(user.id)
    check(
      'the acknowledged name is gone from the very next read',
      !afterSeen.items.some((i) => i.symbol === top.symbol),
      'a stale cached brief here would re-show something already cleared',
    )

    setCacheDisabled(true)
    const uncachedAfterSeen = fingerprint(await buildSitrep(user.id))
    setCacheDisabled(false)
    check(
      'and it matches the uncached answer',
      fingerprint(afterSeen) === uncachedAfterSeen,
    )
  }

  // ------------------------------------------------------------------- 4
  console.log('\n[4] Losing the cache costs latency and nothing else')

  setCacheDisabled(true)
  const degraded = await buildSitrep(user.id)
  setCacheDisabled(false)

  check(
    'the brief renders with the cache switched off entirely',
    degraded.items.length >= 0 && degraded.narrative.text.length > 0,
  )
  check('the ops page can report cache state', cacheStats().enabled === true)

  console.log(`\n${'='.repeat(50)}`)
  console.log(`${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await closeCache()
    await db.$disconnect()
  })
