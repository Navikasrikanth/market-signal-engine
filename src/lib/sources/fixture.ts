import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { BarSource, FetchBarsOptions, RawBar } from './types'
import { SourceDataError } from './types'

/**
 * A provider backed by committed history instead of the network.
 *
 * This exists so `FIXTURE_MODE=1` is a real guarantee rather than a claim in a
 * comment. It implements `BarSource` like any other provider, so the queued
 * ingest path runs its own validation, reconciliation and persistence
 * unchanged — a fixture mode that bypassed those would prove nothing about the
 * live path and would let the two drift apart silently.
 *
 * Both providers are replayed from the same file, so cross-source
 * reconciliation (and the disagreements it finds) still exercises for real.
 */

type CompactBar = [string, number, number, number, number, number, number]

interface FixtureFile {
  symbol: string
  sources: Record<string, CompactBar[]>
}

const FIXTURE_DIR = path.join(process.cwd(), 'fixtures', 'bars-trimmed')

/** Parsed files are cached: a 26-symbol batch would otherwise re-read each one. */
const cache = new Map<string, FixtureFile>()

async function load(symbol: string): Promise<FixtureFile> {
  const hit = cache.get(symbol)
  if (hit) return hit

  let raw: string
  try {
    raw = await readFile(path.join(FIXTURE_DIR, `${symbol}.json`), 'utf8')
  } catch {
    throw new SourceDataError('fixture', symbol, 'no committed fixture')
  }

  const parsed = JSON.parse(raw) as FixtureFile
  cache.set(symbol, parsed)
  return parsed
}

export class FixtureSource implements BarSource {
  constructor(
    readonly id: string,
    readonly trustRank: number,
  ) {}

  async fetchDailyBars(
    symbol: string,
    opts: FetchBarsOptions = {},
  ): Promise<RawBar[]> {
    const file = await load(symbol)
    const rows = file.sources[this.id]
    if (!rows) {
      throw new SourceDataError('fixture', symbol, `no ${this.id} series`)
    }

    return rows
      .filter(([date]) => {
        if (opts.from && date < opts.from) return false
        if (opts.to && date > opts.to) return false
        return true
      })
      .map(([date, open, high, low, close, closeAdj, volume]) => ({
        date,
        open,
        high,
        low,
        close,
        closeAdj,
        volume,
      }))
  }
}

/**
 * Should this run offline?
 *
 * Detected rather than declared. The product's whole premise is "what changed
 * since you last looked", so a configuration that can never change is a
 * contradiction — and making offline the default meant anyone who had supplied
 * API keys still got frozen data until they remembered a second switch. A flag
 * people must remember to flip is a flag that will be wrong.
 *
 * So: keys present means live, keys absent means fixtures. A reviewer cloning
 * with no credentials gets a working product; anyone who has gone to the
 * trouble of getting keys gets the live one, without being asked twice.
 *
 * `FIXTURE_MODE` still overrides in both directions, because forcing offline is
 * a real need — running the test suite, demonstrating without burning quota, or
 * proving the no-network claim.
 */
export function fixtureMode(): boolean {
  const explicit = process.env.FIXTURE_MODE
  if (explicit === '1' || explicit === 'true') return true
  if (explicit === '0' || explicit === 'false') return false

  // Unset: decide from what is actually available. Bars need BOTH providers,
  // because a single source cannot be reconciled and reconciliation is not
  // optional here.
  return !(process.env.TWELVE_DATA_API_KEY && process.env.TIINGO_API_KEY)
}
