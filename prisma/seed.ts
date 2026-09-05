import 'dotenv/config'
import { hashPassword } from '../src/lib/auth'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { UNIVERSE, DEMO_WATCHLIST } from '../src/lib/universe'
import { HISTORICAL_CONTEXT } from './context-seed'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const db = new PrismaClient({ adapter })

const DEMO_EMAIL = 'demo@sitrep.local'
// At least 12 characters, so the demo account satisfies the same policy
// `register` enforces. Shipping a demo credential that the product's own
// rules would reject invites exactly one question, and it has no good answer.
const DEMO_PASSWORD = 'sitrep-demo-2026'

async function seedInstruments() {
  // Two passes: every instrument must exist before we can wire the
  // self-referencing sector-proxy foreign key.
  for (const inst of UNIVERSE) {
    await db.instrument.upsert({
      where: { symbol: inst.symbol },
      create: {
        symbol: inst.symbol,
        name: inst.name,
        sector: inst.sector,
        isEtf: inst.isEtf,
      },
      update: { name: inst.name, sector: inst.sector, isEtf: inst.isEtf },
    })
  }

  for (const inst of UNIVERSE) {
    if (!inst.sectorEtf) continue
    const proxy = await db.instrument.findUnique({
      where: { symbol: inst.sectorEtf },
      select: { id: true },
    })
    if (!proxy) throw new Error(`sector proxy ${inst.sectorEtf} missing`)
    await db.instrument.update({
      where: { symbol: inst.symbol },
      data: { sectorEtfId: proxy.id },
    })
  }

  console.log(`  instruments: ${UNIVERSE.length}`)
}

async function seedDataSources() {
  // trustRank: lower wins when two sources disagree within tolerance.
  // Twelve Data is primary (full history, 800 req/day); Tiingo is the
  // independent cross-check that makes reconciliation meaningful.
  const sources = [
    {
      id: 'twelvedata',
      kind: 'bar',
      trustRank: 1,
      rateLimit: { perMin: 8, perDay: 800, burst: 4 },
    },
    {
      id: 'tiingo',
      kind: 'bar',
      trustRank: 2,
      rateLimit: { perHour: 50, perDay: 1000, burst: 5 },
    },
    {
      id: 'finnhub',
      kind: 'earnings',
      trustRank: 1,
      // Free tier serves FORWARD earnings only; historical windows return zero
      // rows, so the earnings detector is live-only and is excluded from
      // historical calibration.
      rateLimit: { perMin: 60, perDay: 100000, burst: 10 },
    },
  ]

  for (const s of sources) {
    await db.dataSource.upsert({
      where: { id: s.id },
      create: s,
      update: { kind: s.kind, trustRank: s.trustRank, rateLimit: s.rateLimit },
    })
    await db.dataFreshness.upsert({
      where: { sourceId_kind: { sourceId: s.id, kind: s.kind } },
      create: { sourceId: s.id, kind: s.kind },
      update: {},
    })
  }

  console.log(`  data sources: ${sources.length}`)
}

async function seedDemoUser() {
  // Via hashPassword, not bcrypt directly, so the seed cannot drift from the
  // application's cost factor - it was still hashing at 10 after auth moved
  // to 12.
  // Curated historical context. Replaced wholesale rather than merged: the
  // table is a hand-maintained list, and a half-updated one would be worse
  // than either version of it.
  await db.historicalContextEvent.deleteMany({})
  await db.historicalContextEvent.createMany({
    data: HISTORICAL_CONTEXT.map((c) => ({
      eventDate: new Date(`${c.eventDate}T00:00:00Z`),
      eventEndDate: c.eventEndDate
        ? new Date(`${c.eventEndDate}T00:00:00Z`)
        : null,
      title: c.title,
      description: c.description,
      category: c.category,
      scope: c.scope,
      importance: c.importance,
      source: c.source,
      sourceUrl: c.sourceUrl,
      sectors: c.sectors,
    })),
  })
  console.log(`  historical context: ${HISTORICAL_CONTEXT.length} curated events`)

  const passwordHash = await hashPassword(DEMO_PASSWORD)

  const user = await db.user.upsert({
    where: { email: DEMO_EMAIL },
    create: {
      email: DEMO_EMAIL,
      passwordHash,
      displayName: 'Navika',
      settings: { attentionBudget: 5, timezone: 'America/New_York' },
    },
    update: { passwordHash },
  })

  let watchlist = await db.watchlist.findFirst({ where: { userId: user.id } })
  if (!watchlist) {
    watchlist = await db.watchlist.create({
      data: { userId: user.id, name: 'My Watchlist' },
    })
  }

  for (const symbol of DEMO_WATCHLIST) {
    const inst = await db.instrument.findUnique({
      where: { symbol },
      select: { id: true },
    })
    if (!inst) continue
    await db.watchlistItem.upsert({
      where: {
        watchlistId_instrumentId: {
          watchlistId: watchlist.id,
          instrumentId: inst.id,
        },
      },
      create: { watchlistId: watchlist.id, instrumentId: inst.id },
      update: {},
    })
  }

  console.log(`  demo user: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`)
  console.log(`  watchlist: ${DEMO_WATCHLIST.length} names`)
  return user
}

async function main() {
  console.log('seeding...')
  await seedInstruments()
  await seedDataSources()
  await seedDemoUser()
  console.log('done.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
