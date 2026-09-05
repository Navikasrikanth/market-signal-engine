import type { Intent } from './types'

/**
 * The same number, framed by what you said you were doing.
 *
 * `intent` has been captured since the first version and has only ever moved a
 * score multiplier. But a move does not mean one thing — it means something
 * different depending on the position behind it. A name you hold falling 8% is
 * a loss. The identical fall on a name you are waiting to buy is the entry
 * getting cheaper. A hedge falling while the market rises is the hedge
 * *working*.
 *
 * So this is not decoration. It is the difference between a market data
 * product and a product about someone's actual exposure, and it costs nothing
 * extra to compute — every input is already on the item.
 *
 * Deliberately no position SIZE, no cost basis, no P&L. The product does not
 * ask for holdings and should not pretend to know them; "you hold this" is a
 * user-declared intent, not a brokerage link. Everything below is phrased so
 * it stays true without knowing how much.
 *
 * Pure: no database, no clock.
 */

export interface PositionContext {
  intent: Intent
  /** Net move over the absence window, as a fraction. */
  returnPct: number | null
  /** Move in units of the name's own volatility, when known. */
  sigmas: number | null
  /** How far the window high sits from today, signed. */
  peakFromNowPct: number | null
  /** How far the window low sits from today, signed. */
  troughFromNowPct: number | null
}

export interface PositionFraming {
  /** One sentence about what this means for this position. */
  text: string
  /**
   * Whether this is, for THIS position, a good or bad development.
   *
   * Not the direction of the price: a hedge falling is `adverse` for the hedge
   * and probably fine for the portfolio, and a considered buy falling is
   * `favourable` even though the chart is down.
   */
  tone: 'favourable' | 'adverse' | 'neutral'
  /** Shown as a chip, so the framing is legible without reading the sentence. */
  label: string
}

function pct(x: number): string {
  return `${Math.abs(x * 100).toFixed(1)}%`
}

/** Below this the move is not worth reframing; it is noise either way. */
const MATERIAL = 0.02

export function frameForPosition(
  ctx: PositionContext,
): PositionFraming | null {
  const move = ctx.returnPct
  if (move === null || Math.abs(move) < MATERIAL) return null

  const up = move > 0

  switch (ctx.intent) {
    case 'HOLDING': {
      // A holder cares about the round trip as much as the endpoint: giving
      // back a gain is a different experience from never having had it.
      const gaveBack =
        up && (ctx.peakFromNowPct ?? 0) >= 0.08
          ? ` It reached ${pct(ctx.peakFromNowPct!)} higher before easing back.`
          : ''

      return up
        ? {
            text: `You hold this. It is worth ${pct(move)} more than when you last looked.${gaveBack}`,
            tone: 'favourable',
            label: 'HOLDING · UP',
          }
        : {
            text: `You hold this. It is worth ${pct(move)} less than when you last looked.`,
            tone: 'adverse',
            label: 'HOLDING · DOWN',
          }
    }

    case 'CONSIDERING_BUY': {
      // The inversion that makes the whole feature worth building: for a buyer
      // waiting, down is the good news.
      return up
        ? {
            text: `You were considering buying. It has become ${pct(move)} more expensive since you last looked.`,
            tone: 'adverse',
            label: 'ENTRY WORSE',
          }
        : {
            text: `You were considering buying. It is ${pct(move)} cheaper than when you last looked.`,
            tone: 'favourable',
            label: 'ENTRY BETTER',
          }
    }

    case 'HEDGE': {
      // A hedge is supposed to move against the thing it protects. Falling is
      // not automatically bad, and rising is not automatically good.
      return up
        ? {
            text: `This is a hedge. It gained ${pct(move)}, which usually means the thing it protects against was under pressure.`,
            tone: 'neutral',
            label: 'HEDGE · GAINED',
          }
        : {
            text: `This is a hedge. It lost ${pct(move)} — cover costs something in a calm market, and that is the trade.`,
            tone: 'neutral',
            label: 'HEDGE · COST',
          }
    }

    case 'THEMATIC': {
      // Watching an idea rather than a position. Magnitude relative to the
      // name's own volatility is the useful framing, not the raw percentage.
      const unusual =
        ctx.sigmas !== null && Math.abs(ctx.sigmas) >= 2
          ? ' That is a large move by this name’s own standards.'
          : ''
      return {
        text: `You are watching this as a theme, not a position. It moved ${pct(move)} ${up ? 'up' : 'down'}.${unusual}`,
        tone: 'neutral',
        label: 'THEME WATCH',
      }
    }

    case 'NONE':
    default:
      // No stated intent means no basis for a claim about what it means. The
      // card already says what happened; inventing a frame would be worse than
      // leaving it plain.
      return null
  }
}

/** Intents that represent actual exposure, for the positions view. */
export const EXPOSED_INTENTS: Intent[] = ['HOLDING', 'HEDGE']

export const INTENT_LABEL: Record<Intent, string> = {
  HOLDING: 'Holding',
  CONSIDERING_BUY: 'Considering',
  THEMATIC: 'Thematic',
  HEDGE: 'Hedge',
  NONE: 'No stated intent',
}
