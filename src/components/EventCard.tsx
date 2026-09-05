'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { SitrepItem } from '@/lib/sitrep'
import type { TrackRecord } from '@/engine/followthrough'
import { WhyPanel } from './WhyPanel'
import { Spotlight } from './Spotlight'
import {
  AttentionScore,
  Change,
  Money,
  SeverityChip,
  Sparkline,
} from './primitives'

/**
 * One name in the brief.
 *
 * The card leads with what changed and why it matters, not with a price. The
 * price is present but subordinate — a returning user already knows roughly
 * what their names are worth; what they do not know is what happened while
 * they were gone.
 */
export function EventCard({
  item,
  trackRecord,
}: {
  item: SitrepItem
  trackRecord?: Record<string, TrackRecord>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [dismissed, setDismissed] = useState(false)

  /**
   * Acknowledge, then re-render from the server.
   *
   * The card hides optimistically so the interaction feels immediate, but the
   * refresh is what makes the screen agree with the cursor. Without it the UI
   * and the server drifted: the card vanished locally while the next reload
   * brought it straight back, because nothing had re-read the brief.
   */
  async function act(url: string, body: unknown) {
    setDismissed(true)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(String(res.status))
      startTransition(() => router.refresh())
    } catch {
      // Put the card back rather than pretending the write landed.
      setDismissed(false)
    }
  }

  /** Acknowledge: moves the cursor, so the next brief measures from now. */
  const markSeen = () =>
    act('/api/watch-state/mark-seen', {
      symbols: [item.symbol],
      eventIds: item.eventIds,
      // Where it sat when cleared, so the next brief can say whether it has
      // climbed or fallen in your attention since.
      ranks: { [item.symbol]: item.rank },
    })

  /**
   * Defer: moves nothing. The cursor stays where it is, so this event comes
   * back tomorrow with its original timestamp rather than being quietly lost.
   */
  const snooze = () =>
    act('/api/watch-state/snooze', { eventIds: item.eventIds, hours: 24 })

  if (dismissed && !pending) return null

  const accent =
    item.severity === 'CRITICAL'
      ? 'var(--sev-critical)'
      : item.severity === 'IMPORTANT'
        ? 'var(--sev-important)'
        : 'var(--sev-watch)'

  return (
    <Spotlight
      as="article"
      /*
       * The animated gradient edge is reserved for CRITICAL and nothing else.
       * On one card in five it reads as urgency; on every card it is
       * wallpaper, and a product whose whole argument is about rationing
       * attention cannot afford chrome that ignores its own rule.
       */
      className={`card relative p-4 ${
        item.severity === 'CRITICAL' ? 'edge-critical' : ''
      }`}
    >
      {/* The severity rail. A painted element rather than a border, so the
          card's own radius stays intact at the corners. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[2px] rounded-l-[var(--r-lg)]"
        style={{
          background: accent,
          // Slightly proud of the card face, so on a turn it reads as an edge
          // with thickness rather than a stripe painted on flat card stock.
          transform: 'translateZ(6px)',
          boxShadow: `0 0 14px -2px ${accent}`,
        }}
      />
      <div
        className="transition-opacity"
        style={{ opacity: dismissed ? 0.4 : 1 }}
      >
      {/* The front plane. Symbol, severity and score stand closest to the
          viewer, so turning the card parallaxes them against the body text
          behind — the depth is geometry, not a second animation. */}
      <header className="layer-2 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-base font-semibold tracking-wide">
              {item.symbol}
            </h3>
            <SeverityChip severity={item.severity} />
            {item.framing && (
              <span
                className="rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tracking-wider"
                style={{
                  borderColor:
                    item.framing.tone === 'favourable'
                      ? 'var(--up)'
                      : item.framing.tone === 'adverse'
                        ? 'var(--down)'
                        : 'var(--border-strong)',
                  color:
                    item.framing.tone === 'neutral'
                      ? 'var(--ink-3)'
                      : item.framing.tone === 'favourable'
                        ? 'var(--up)'
                        : 'var(--down)',
                }}
              >
                {item.framing.label}
              </span>
            )}
            <RankChurn rank={item.rank} previous={item.previousRank} />
            {item.priority !== 'NORMAL' && (
              <span className="rounded-sm border border-[color:var(--border-strong)] px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-[color:var(--ink-3)]">
                {item.priority} PRIORITY
              </span>
            )}
            {!item.confirmed ? (
              <span
                className="rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tracking-wider"
                style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
                title="Two data sources disagree on this price beyond tolerance"
              >
                UNCONFIRMED
              </span>
            ) : !item.corroborated ? (
              <span
                className="rounded-sm border border-[color:var(--border-strong)] px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-[color:var(--ink-3)]"
                title="Only one source reported this price. Uncorroborated, but nothing contradicts it."
              >
                SINGLE SOURCE
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-[color:var(--ink-3)]">
            {item.name}
            {item.sector ? ` · ${item.sector}` : ''}
          </p>
        </div>

        <span className="layer-3 block">
          <AttentionScore score={item.attentionScore} />
        </span>
      </header>

      <p className="layer-1 mt-3 text-[15px] leading-snug text-[color:var(--ink)]">
        {item.headline}
      </p>

      <div className="layer-1 mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <span className="flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-wider text-[color:var(--ink-3)]">
            SINCE YOU LOOKED
          </span>
          <Change pct={item.windowReturnPct} />
        </span>
        <Money
          value={item.lastClose}
          asOf={item.asOf}
          confirmed={item.confirmed}
          confidence={item.confidence}
        />
        <span className="ml-auto">
          <Sparkline points={item.sparkline} />
        </span>
      </div>

      {item.framing && (
        <p
          className="mt-2 text-sm leading-snug"
          style={{
            color:
              item.framing.tone === 'favourable'
                ? 'var(--up)'
                : item.framing.tone === 'adverse'
                  ? 'var(--down)'
                  : 'var(--ink-2)',
          }}
        >
          {item.framing.text}
        </p>
      )}

      <Path peak={item.peak} trough={item.trough} />

      <Coverage items={item.coverage} />

      <WhyPanel
        score={item.attentionScore}
        positives={item.positives}
        suppressors={item.suppressors}
        trackRecord={trackRecord}
      />

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={markSeen}
          className="btn px-2.5 py-1 font-mono text-[11px] tracking-wide"
        >
          Mark seen
        </button>
        {/*
          A bare `title` becomes the accessible name in some assistive tooling,
          which announces the tooltip instead of the control. Naming the button
          explicitly keeps the spoken label and the visible label identical.
        */}
        <button
          type="button"
          onClick={snooze}
          aria-label="Snooze 24h"
          title="Hide for 24 hours without moving your cursor"
          className="btn px-2.5 py-1 font-mono text-[11px] tracking-wide"
        >
          Snooze 24h
        </button>
      </div>
      </div>
    </Spotlight>
  )
}

/**
 * What was published around the same time.
 *
 * Corroboration, never a signal. These headlines did not create the event and
 * did not move the score by a single point — the price engine found this on
 * its own, and the news is here so a reader does not have to go and look it up
 * elsewhere.
 *
 * Ranked by how many distinct outlets carried the story, because the provider
 * returns hundreds of syndicated copies from a handful of sources: counting
 * articles would measure publishing cadence and present it as importance.
 *
 * Absent is the normal state, and silence here means nothing: a name with no
 * coverage is not less important, only less written about.
 */
function Coverage({ items }: { items: SitrepItem['coverage'] }) {
  if (items.length === 0) return null

  return (
    <div className="mt-3 border-t border-[color:var(--border)] pt-2">
      <p className="font-mono text-[10px] tracking-wider text-[color:var(--ink-3)]">
        REPORTED THAT DAY · did not affect the score
      </p>
      <ul className="mt-1 flex flex-col gap-1">
        {items.map((c) => (
          <li key={c.url} className="text-xs leading-snug">
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[color:var(--ink-2)] underline decoration-dotted underline-offset-2 hover:text-[color:var(--accent-ink)]"
            >
              {c.headline}
            </a>{' '}
            <span className="text-[color:var(--ink-3)]">
              {c.outlets > 1 ? `· ${c.outlets} outlets` : `· ${c.source}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Where it went while you were not looking.
 *
 * The card shows where the price started and where it ended. Between those two
 * numbers is everything that actually happened, and someone away for ten weeks
 * missed all of it.
 *
 * The test for "worth saying" is against the BASELINE, not against today. A
 * name up 76% will always have been far lower at some point - that is
 * arithmetic, not information, and reporting it made every card say the same
 * thing. What is worth saying is that the price went somewhere the endpoints
 * do not imply: below where you left it before recovering, or above where it
 * is now before easing back.
 */
function Path({
  peak,
  trough,
}: {
  peak: SitrepItem['peak']
  trough: SitrepItem['trough']
}) {
  /** Went ABOVE today and came back down. */
  const gaveBack =
    peak && peak.fromNowPct >= 0.05
      ? {
          word: 'REACHED',
          close: peak.close,
          date: peak.date,
          amount: peak.fromNowPct,
          tail: 'higher before easing back',
          up: true,
        }
      : null

  /** Went BELOW where you last saw it, and recovered. */
  const dipped =
    trough && trough.fromBaselinePct <= -0.05
      ? {
          word: 'FELL TO',
          close: trough.close,
          date: trough.date,
          amount: trough.fromBaselinePct,
          tail: 'below where you last saw it, then recovered',
          up: false,
        }
      : null

  // At most one line. Whichever excursion was larger is the one worth the
  // reader's attention; both would be a chart, and the card already has one.
  const notable =
    gaveBack && dipped
      ? Math.abs(gaveBack.amount) >= Math.abs(dipped.amount)
        ? gaveBack
        : dipped
      : (gaveBack ?? dipped)

  if (!notable) return null

  return (
    <p className="mt-2 text-xs text-[color:var(--ink-3)]">
      <span className="font-mono text-[10px] tracking-wider">
        {notable.word}
      </span>{' '}
      <span className="tabular text-[color:var(--ink-2)]">
        ${notable.close.toFixed(2)}
      </span>{' '}
      on {notable.date} —{' '}
      <span
        style={{ color: notable.up ? 'var(--up)' : 'var(--down)' }}
        className="tabular"
      >
        {(Math.abs(notable.amount) * 100).toFixed(1)}%
      </span>{' '}
      {notable.tail}.
    </p>
  )
}

/**
 * Has this climbed or fallen in your attention since you last cleared it?
 *
 * Nothing else in the product answers that. The score says how much this
 * matters; the change in RANK says how much it matters relative to everything
 * else you watch, which is the comparison a person actually makes.
 *
 * Silent unless it moved. "Still 3rd" is not news.
 */
function RankChurn({
  rank,
  previous,
}: {
  rank: number
  previous: number | null
}) {
  if (previous === null || previous === rank) return null

  const climbed = rank < previous
  return (
    <span
      className="rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tracking-wider"
      style={{
        borderColor: 'var(--border-strong)',
        color: climbed ? 'var(--accent-ink)' : 'var(--ink-3)',
      }}
      title={`Was ranked ${previous} when you last cleared it`}
    >
      {climbed ? '▲' : '▼'} {previous} → {rank}
    </span>
  )
}
