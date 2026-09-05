import { describe, expect, it } from 'vitest'
import { frameForPosition } from '../position'

/**
 * The point of this module is a single inversion: the same fall is a loss for
 * a holder and an improvement for someone waiting to buy. If the tests only
 * checked wording, they would not be testing the idea.
 */

function ctx(over: Partial<Parameters<typeof frameForPosition>[0]> = {}) {
  return {
    intent: 'HOLDING' as const,
    returnPct: -0.08,
    sigmas: -1.2,
    peakFromNowPct: null,
    troughFromNowPct: null,
    ...over,
  }
}

describe('frameForPosition', () => {
  it('reads the same fall in opposite directions', () => {
    const holder = frameForPosition(ctx({ intent: 'HOLDING' }))!
    const buyer = frameForPosition(ctx({ intent: 'CONSIDERING_BUY' }))!

    expect(holder.tone).toBe('adverse')
    expect(buyer.tone).toBe('favourable')

    expect(holder.text).toMatch(/worth 8.0% less/)
    expect(buyer.text).toMatch(/8.0% cheaper/)
  })

  it('reads the same rise in opposite directions too', () => {
    const holder = frameForPosition(ctx({ intent: 'HOLDING', returnPct: 0.08 }))!
    const buyer = frameForPosition(
      ctx({ intent: 'CONSIDERING_BUY', returnPct: 0.08 }),
    )!

    expect(holder.tone).toBe('favourable')
    // A rise is bad news for someone still waiting to get in.
    expect(buyer.tone).toBe('adverse')
    expect(buyer.text).toMatch(/more expensive/)
  })

  it('tells a holder when a gain was given back', () => {
    const framing = frameForPosition(
      ctx({ intent: 'HOLDING', returnPct: 0.05, peakFromNowPct: 0.19 }),
    )!
    expect(framing.text).toMatch(/19.0% higher before easing back/)
  })

  it('does not call a falling hedge bad news', () => {
    // A hedge losing money in a calm market is the hedge doing its job at its
    // stated cost, not a problem to be alarmed about.
    const framing = frameForPosition(
      ctx({ intent: 'HEDGE', returnPct: -0.06 }),
    )!
    expect(framing.tone).toBe('neutral')
    expect(framing.text).toMatch(/cover costs something/)
  })

  it('does not call a rising hedge good news either', () => {
    const framing = frameForPosition(ctx({ intent: 'HEDGE', returnPct: 0.06 }))!
    expect(framing.tone).toBe('neutral')
  })

  it('frames a thematic watch by the name’s own volatility', () => {
    const ordinary = frameForPosition(
      ctx({ intent: 'THEMATIC', returnPct: 0.05, sigmas: 0.8 }),
    )!
    const unusual = frameForPosition(
      ctx({ intent: 'THEMATIC', returnPct: 0.05, sigmas: 3.1 }),
    )!

    expect(ordinary.text).not.toMatch(/large move/)
    expect(unusual.text).toMatch(/large move/)
    expect(unusual.tone).toBe('neutral')
  })

  it('says nothing without a stated intent', () => {
    // No intent is no basis for a claim about meaning. The card already says
    // what happened; inventing a frame would be worse than leaving it plain.
    expect(frameForPosition(ctx({ intent: 'NONE' }))).toBeNull()
  })

  it('keeps the position label when the price barely moved', () => {
    // The bug this replaces: anything under 2% returned null, so a name you
    // had declared as HOLDING lost its label entirely. TSLA sat on the brief
    // for a volume spike, moved 1.5% over the week, and read as though no
    // position had ever been stated.
    //
    // Whether you hold something is a fact about YOU. It does not stop being
    // true because the price was quiet.
    const flat = frameForPosition(ctx({ returnPct: 0.015 }))!

    expect(flat.label).toMatch(/^HOLDING/)
    expect(flat.tone).toBe('neutral')
    expect(flat.text).toMatch(/You hold this\./)
    // And it says the useful thing: the alert was about something else.
    expect(flat.text).toMatch(/barely moved/)
    expect(flat.text).toMatch(/it was not that/)
  })

  it('labels a quiet move for every stated intent', () => {
    for (const intent of ['HOLDING', 'CONSIDERING_BUY', 'HEDGE', 'THEMATIC'] as const) {
      const f = frameForPosition(ctx({ intent, returnPct: -0.008 }))!
      expect(f).not.toBeNull()
      expect(f.label.length).toBeGreaterThan(0)
      expect(f.tone).toBe('neutral')
    }
  })

  it('still says nothing without a usable move', () => {
    expect(frameForPosition(ctx({ returnPct: null }))).toBeNull()
  })

  it('never claims to know position size or profit', () => {
    // The product does not ask for holdings and must not imply it knows them.
    for (const intent of ['HOLDING', 'CONSIDERING_BUY', 'HEDGE', 'THEMATIC'] as const) {
      const f = frameForPosition(ctx({ intent, returnPct: -0.09 }))
      if (!f) continue
      expect(f.text).not.toMatch(/\$|profit|loss of|P&L|your position is worth/i)
    }
  })
})
