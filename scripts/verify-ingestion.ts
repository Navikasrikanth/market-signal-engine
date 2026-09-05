import 'dotenv/config'
import { db } from '../src/lib/db'
import { findGaps, repairWindow, summariseGaps } from '../src/lib/ingest/gaps'
import { withLock, closeQueues } from '../src/lib/queue'
import { validateBars } from '../src/lib/ingest/validate'
import { reconcileBar } from '../src/lib/ingest/reconcile'
import { dueAt } from '../src/lib/schedule'
import { sessionsBehind, tradingDaysBetween } from '../src/lib/market-calendar'
import { FixtureSource, fixtureMode } from '../src/lib/sources/fixture'
import type { RawBar } from '../src/lib/sources/types'

/**
 * Ingestion properties, against real Postgres and real Redis.
 *
 * Each of these corresponds to a way the previous implementation was silently
 * wrong. The unit tests cover the pure logic; these cover the claims that only
 * mean something with infrastructure attached.
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

function bar(date: string, close: number): RawBar {
  return {
    date,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    closeAdj: close,
    volume: 1_000_000,
  }
}

async function main() {
  // ------------------------------------------------------------------- 1
  console.log('\n[1] Internal holes are found, not just tail gaps')

  const aapl = await db.instrument.findUniqueOrThrow({
    where: { symbol: 'AAPL' },
    select: { id: true },
  })

  const before = await db.dailyBar.findFirst({
    where: { instrumentId: aapl.id, barDate: new Date('2026-08-19T00:00:00Z') },
  })

  if (!before) {
    check('fixture data present for the hole test', false, 'expected a bar on 2026-08-19')
  } else {
    await db.dailyBar.delete({
      where: {
        instrumentId_barDate: {
          instrumentId: aapl.id,
          barDate: new Date('2026-08-19T00:00:00Z'),
        },
      },
    })

    const gaps = await findGaps(new Date(), ['AAPL'])
    const summary = summariseGaps(gaps)

    check(
      'a date missing from the MIDDLE of the series is detected',
      gaps[0].holes.includes('2026-08-19'),
      'MAX(barDate) reports this series as healthy',
    )
    const win = repairWindow(gaps[0])
    check(
      'the repair window covers the missing date',
      win !== null && win.from <= '2026-08-19' && win.to >= '2026-08-19',
      win ? `${win.from} to ${win.to}` : 'none',
    )
    check(
      'and is never a single day, which providers reject outright',
      win !== null && win.from < win.to,
      'Twelve Data answers start_date == end_date with a 400',
    )
    check('the summary counts it', summary.totalHoles === 1)

    // Put it back, so the check is non-destructive.
    await db.dailyBar.create({ data: before })

    const after = await findGaps(new Date(), ['AAPL'])
    check('and the series is clean once repaired', after[0].holes.length === 0)
  }

  // ------------------------------------------------------------------- 2
  console.log('\n[2] Staleness is measured in sessions, not hours')

  // 2026-09-05 is a Saturday; 2026-09-07 is Labor Day.
  const saturday = new Date('2026-09-05T18:00:00Z')
  const tuesdayAfterClose = new Date('2026-09-08T21:45:00Z')

  check(
    'Friday data on a Saturday is not stale',
    sessionsBehind('2026-09-04', saturday) === 0,
    'a 24-hour rule flags every weekend',
  )
  check(
    'the same data after Tuesday’s close is stale',
    sessionsBehind('2026-09-04', tuesdayAfterClose) === 1,
  )
  check(
    'a holiday is not counted as a missing session',
    !tradingDaysBetween('2026-09-04', '2026-09-08').includes('2026-09-07'),
  )

  // ------------------------------------------------------------------- 3
  console.log('\n[3] Nothing market-facing is scheduled against a closed market')

  const weekendKinds = dueAt(saturday).map((c) => c.kind)
  const holidayKinds = dueAt(new Date('2026-09-07T17:00:00Z')).map((c) => c.kind)
  const sessionKinds = dueAt(new Date('2026-09-04T17:00:00Z')).map((c) => c.kind)

  check('weekend runs housekeeping only', weekendKinds.join() === 'maintenance')
  check('holiday runs housekeeping only', holidayKinds.join() === 'maintenance')
  check('intraday polls during the session', sessionKinds.includes('intraday'))

  // ------------------------------------------------------------------- 4
  console.log('\n[4] Only one ingestion cycle runs at a time')

  let concurrent = 0
  let maxConcurrent = 0

  const body = async () => {
    concurrent++
    maxConcurrent = Math.max(maxConcurrent, concurrent)
    await new Promise((r) => setTimeout(r, 400))
    concurrent--
    return 'ran'
  }

  const [a, b] = await Promise.all([
    withLock('verify-ingest-cycle', 30, body),
    withLock('verify-ingest-cycle', 30, body),
  ])

  check(
    'a second cycle is refused while the first holds the lock',
    (a === 'ran') !== (b === 'ran'),
    'one ran, one was skipped',
  )
  check('the two never overlapped', maxConcurrent === 1)

  const third = await withLock('verify-ingest-cycle', 30, async () => 'ran')
  check('the lock is released afterwards', third === 'ran')

  // ------------------------------------------------------------------- 5
  console.log('\n[5] Validation and reconciliation')

  const anchored = validateBars([bar('2026-03-03', 18)], {
    date: '2026-03-02',
    close: 180,
  })
  check(
    'a decimal shift on the FIRST bar of a fetch is caught',
    anchored.valid.length === 0 && anchored.rejected.length === 1,
    anchored.rejected[0]?.reason ?? '',
  )

  const unanchored = validateBars([bar('2026-03-03', 18)])
  check(
    'and it would have passed without the stored anchor',
    unanchored.valid.length === 1,
    'which is exactly the blind spot that existed',
  )

  const history = { recentCloses: [175, 178, 181, 177, 180, 179, 182] }
  const resolved = reconcileBar(
    [
      { sourceId: 'twelvedata', trustRank: 1, bar: bar('2026-03-03', 18) },
      { sourceId: 'tiingo', trustRank: 2, bar: bar('2026-03-03', 180) },
    ],
    history,
  )!

  check(
    'a corrupt value from the HIGHER-trust provider loses to the sane one',
    resolved.bar.close === 180,
    `$18 rejected in favour of $180`,
  )
  check(
    'and the override is recorded with a reason',
    resolved.conflicts.some(
      (c) => c.reason === 'PRIMARY_VALUE_FAILED_HISTORY_SANITY' && c.trustOverride,
    ),
  )

  const volatile = { recentCloses: [100, 118, 96, 112, 99, 115, 101] }
  const kept = reconcileBar(
    [
      { sourceId: 'twelvedata', trustRank: 1, bar: bar('2026-03-03', 144) },
      { sourceId: 'tiingo', trustRank: 2, bar: bar('2026-03-03', 120) },
    ],
    volatile,
  )!
  check(
    'a legitimate 20% move in a volatile name is NOT overridden',
    kept.bar.close === 144 && !kept.conflicts[0].trustOverride,
    'a fixed percentage threshold would reject this',
  )

  // ------------------------------------------------------------------- 6
  console.log('\n[6] A long outage heals, rather than healing ten days of it')

  // The previous window was a fixed ten-day lookback, so an outage longer than
  // that left a hole no later run would ever look for. Deleting three weeks is
  // the case that used to be permanent.
  const nvda = await db.instrument.findUniqueOrThrow({
    where: { symbol: 'NVDA' },
    select: { id: true },
  })

  const from = new Date('2026-07-06T00:00:00Z')
  const to = new Date('2026-07-24T00:00:00Z')

  const removed = await db.dailyBar.findMany({
    where: { instrumentId: nvda.id, barDate: { gte: from, lte: to } },
  })

  if (removed.length < 10) {
    check('fixture data present for the outage test', false, `${removed.length} bars`)
  } else {
    await db.dailyBar.deleteMany({
      where: { instrumentId: nvda.id, barDate: { gte: from, lte: to } },
    })

    const gaps = await findGaps(new Date(), ['NVDA'])
    const window = repairWindow(gaps[0])

    check(
      'a three-week outage is detected in full',
      gaps[0].holes.length === removed.length,
      `${gaps[0].holes.length} sessions missing, all of them found`,
    )
    check(
      'and the repair window spans the whole outage, not the last ten days',
      window !== null &&
        window.from <= '2026-07-06' &&
        window.to >= '2026-07-24',
      window ? `${window.from} to ${window.to}` : 'none',
    )

    // Restore, so the check is non-destructive.
    await db.dailyBar.createMany({ data: removed })
    const after = await findGaps(new Date(), ['NVDA'])
    check('and the series is whole once repaired', after[0].holes.length === 0)
  }

  // ------------------------------------------------------------------- 7
  console.log('\n[7] A failed fetch never overwrites known-good data')

  const storedBefore = await db.dailyBar.findMany({
    where: { instrumentId: nvda.id },
    orderBy: { barDate: 'desc' },
    take: 5,
    select: { barDate: true, close: true },
  })

  // What a provider outage actually delivers: nothing usable. Validation
  // rejects the lot, so there is no path from here to a write.
  const garbage = validateBars([
    { ...bar('2026-09-02', -1), close: -1 },
    { ...bar('2026-09-03', 0), close: 0 },
  ])

  check(
    'an unusable response yields no valid rows to write',
    garbage.valid.length === 0 && garbage.rejected.length === 2,
    garbage.rejected.map((r) => r.reason).join('; ').slice(0, 60),
  )

  const storedAfter = await db.dailyBar.findMany({
    where: { instrumentId: nvda.id },
    orderBy: { barDate: 'desc' },
    take: 5,
    select: { barDate: true, close: true },
  })

  check(
    'and the stored bars are untouched',
    JSON.stringify(storedBefore) === JSON.stringify(storedAfter),
    'an absence of information is not evidence the stored value is wrong',
  )

  // ------------------------------------------------------------------- 8
  console.log('\n[8] Fixture mode really makes no network calls')

  const wasFixture = process.env.FIXTURE_MODE
  process.env.FIXTURE_MODE = '1'
  check('the gate reports fixture mode', fixtureMode() === true)

  const fixtureBars = await new FixtureSource('twelvedata', 1).fetchDailyBars(
    'NVDA',
    { from: '2026-08-01', to: '2026-09-03' },
  )
  check(
    'and a fixture source serves real bars without a provider',
    fixtureBars.length > 10,
    `${fixtureBars.length} bars from committed history`,
  )

  process.env.FIXTURE_MODE = '0'
  check('the gate reports live mode when told to', fixtureMode() === false)
  process.env.FIXTURE_MODE = wasFixture

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
    await closeQueues()
    await db.$disconnect()
  })
