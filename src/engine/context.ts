/**
 * Matching market events to what was going on in the world.
 *
 * The engine can detect a crash, a volatility expansion, a correlation regime
 * change. It cannot know that COVID was happening, that SVB failed, or that
 * the Fed had just moved — historical news is unavailable at any price this
 * project can pay, and the free tier retains about two days.
 *
 * So context is a small CURATED dataset, and the matching is deterministic.
 * The language rule is the entire point and is enforced in the template rather
 * than left to discipline:
 *
 *   ✅ "The selloff coincided with rapidly escalating COVID-19 developments."
 *   ❌ "COVID caused the crash."
 *
 * The engine has no way to establish causation and does not pretend to. What
 * it can honestly say is that two things happened at the same time, and how
 * confident it is that they are related at all.
 *
 * Pure: no database, no clock. The caller supplies both the event and the
 * candidate context rows.
 */

export type ContextCategory =
  | 'MONETARY_POLICY'
  | 'MACROECONOMIC'
  | 'GEOPOLITICAL'
  | 'FINANCIAL_CRISIS'
  | 'PUBLIC_HEALTH'
  | 'CORPORATE'
  | 'MARKET_STRUCTURE'

export type ContextScope = 'GLOBAL' | 'US' | 'REGIONAL' | 'SECTOR' | 'COMPANY'

export type Importance = 'HIGH' | 'MEDIUM' | 'LOW'

export interface ContextEvent {
  id: string
  /** `YYYY-MM-DD` */
  eventDate: string
  /** Inclusive end for multi-day episodes, else null. */
  eventEndDate: string | null
  title: string
  description: string
  category: ContextCategory
  scope: ContextScope
  importance: Importance
  source: string
  sourceUrl: string | null
  /** Sectors this bears on. Empty means market-wide. */
  sectors: string[]
}

export interface ContextQuery {
  /** `YYYY-MM-DD` of the market event being explained. */
  date: string
  /** Sector of the instrument, when the event is about one instrument. */
  sector?: string | null
  /** True when the move was market-wide rather than name-specific. */
  marketWide: boolean
}

export interface ContextMatch {
  event: ContextEvent
  /** 0..100. */
  confidence: number
  band: 'HIGH' | 'MEDIUM' | 'LOW'
  components: {
    proximity: number
    scopeRelevance: number
    sectorRelevance: number
    importance: number
  }
}

/** Beyond this many days either side, a coincidence is just a coincidence. */
const MAX_DISTANCE_DAYS = 5

/** Below this, no claim is made at all. */
export const MIN_CONTEXT_CONFIDENCE = 45

/**
 * Importance nudges, it does not decide.
 *
 * A minor event that lines up perfectly in time, scope and sector is still a
 * better explanation than a major one that lines up in none of them, so this
 * stays close to 1.
 */
const IMPORTANCE_WEIGHT: Record<Importance, number> = {
  HIGH: 1,
  MEDIUM: 0.88,
  LOW: 0.79,
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000
}

/**
 * How close in time, 0..1.
 *
 * An episode with an end date counts as distance zero anywhere inside it —
 * "the COVID crash" is a fortnight, not a day, and treating its midpoint as
 * the only relevant date would make the match weakest exactly where the
 * connection is strongest.
 */
function proximityScore(query: ContextQuery, event: ContextEvent): number {
  if (event.eventEndDate) {
    if (query.date >= event.eventDate && query.date <= event.eventEndDate) return 1
  }

  const distance = event.eventEndDate
    ? Math.min(
        daysBetween(query.date, event.eventDate),
        daysBetween(query.date, event.eventEndDate),
      )
    : daysBetween(query.date, event.eventDate)

  if (distance > MAX_DISTANCE_DAYS) return 0
  return 1 - distance / (MAX_DISTANCE_DAYS + 1)
}

/**
 * Does the context's reach match the event's reach?
 *
 * A global macro event explains a market-wide move well and a single stock's
 * idiosyncratic move badly. This is what stops "the Fed raised rates" being
 * attached to a company that fell on its own results that day.
 */
function scopeScore(query: ContextQuery, event: ContextEvent): number {
  const broad = event.scope === 'GLOBAL' || event.scope === 'US'

  if (query.marketWide) return broad ? 1 : 0.3
  // A name-specific move is best explained by something name- or
  // sector-specific.
  if (event.scope === 'COMPANY') return 1
  if (event.scope === 'SECTOR') return 0.8
  return 0.25
}

function sectorScore(query: ContextQuery, event: ContextEvent): number {
  if (event.sectors.length === 0) return query.marketWide ? 1 : 0.5
  if (!query.sector) return 0.4
  return event.sectors.includes(query.sector) ? 1 : 0.1
}

export function scoreContext(
  query: ContextQuery,
  event: ContextEvent,
): ContextMatch | null {
  const proximity = proximityScore(query, event)
  // Nothing outside the window is worth scoring: a market event and a world
  // event a fortnight apart are not evidence of anything.
  if (proximity === 0) return null

  const scopeRelevance = scopeScore(query, event)
  const sectorRelevance = sectorScore(query, event)
  const importance = IMPORTANCE_WEIGHT[event.importance]

  // MULTIPLICATIVE, not a weighted sum.
  //
  // A sum let proximity alone carry an irrelevant match: a global pandemic
  // scored 71 against one company's own results simply because the dates
  // lined up, which is exactly the false explanation this module exists to
  // prevent. Every factor must hold — any one of them near zero kills the
  // match, the same way distinctness vetoes a theme rather than merely
  // voting against one.
  const confidence =
    100 * proximity * scopeRelevance * sectorRelevance * importance

  return {
    event,
    confidence: Math.round(confidence),
    band: confidence >= 75 ? 'HIGH' : confidence >= 55 ? 'MEDIUM' : 'LOW',
    components: { proximity, scopeRelevance, sectorRelevance, importance },
  }
}

/**
 * The best available context, or nothing.
 *
 * Returning nothing is a supported and common outcome. Most market moves have
 * no entry in a curated table, and the honest response is to say so rather
 * than to attach the nearest available headline — which is precisely how a
 * plausible-sounding false explanation gets made.
 */
export function matchContext(
  query: ContextQuery,
  candidates: ContextEvent[],
): ContextMatch | null {
  const scored = candidates
    .map((c) => scoreContext(query, c))
    .filter((m): m is ContextMatch => m !== null)
    .filter((m) => m.confidence >= MIN_CONTEXT_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence)

  return scored[0] ?? null
}

/**
 * The sentence. Deliberately the only place this phrasing exists.
 *
 * Every construction here is temporal — "coincided with", "came during". None
 * asserts a mechanism, because the engine has no evidence of one. Centralising
 * it means the rule is enforced by the code rather than by whoever writes the
 * next component.
 */
export function contextSentence(match: ContextMatch): string {
  const { event, band } = match

  const hedge =
    band === 'HIGH'
      ? 'coincided with'
      : band === 'MEDIUM'
        ? 'came during'
        : 'overlapped with'

  return `This ${hedge} ${event.title}.`
}

/** What to say when nothing matched. Also deliberately centralised. */
export const NO_CONTEXT_SENTENCE =
  'No major contextual event was identified in the available historical context.'
