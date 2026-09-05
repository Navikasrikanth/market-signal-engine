'use client'

import { useEffect, useRef } from 'react'
import type { Severity } from '@/engine/types'

/**
 * The watchlist as a field, with the budget line drawn across it.
 *
 * This is the product's argument as a single image. Every name you watch is a
 * point: vertical position is its attention score, size is its severity,
 * colour is the same severity token used on the cards. A line marks the
 * attention budget — points above it are the cards you were shown, everything
 * below is dimmed, held back on purpose.
 *
 * **Most of the field sits below the line, and that is the point.** A watchlist
 * that surfaces everything has no opinion, and no summary sentence makes that
 * as immediate as seeing it.
 *
 * It is not decoration: every coordinate comes from data the engine already
 * computed. There is no seeded noise standing in for real points, and when the
 * watchlist is empty this renders nothing rather than an idle animation.
 *
 * Drawn on a 2D canvas, capped at 30fps, paused when off-screen, and reduced to
 * a single static frame when the viewer has asked for less motion.
 */

export interface FieldPoint {
  symbol: string
  score: number
  severity: Severity
  /** Above the attention budget — i.e. it reached the brief. */
  surfaced: boolean
  /** Silenced by the user. Drawn hollow: present, deliberately quiet. */
  snoozed?: boolean
}

const SEV_COLOR: Record<Severity, string> = {
  CRITICAL: '#e5645a',
  IMPORTANT: '#e0a33d',
  WATCH: '#5aa9c9',
  INFO: '#8a93a0',
  NOISE: '#4a525f',
}

const SEV_RADIUS: Record<Severity, number> = {
  CRITICAL: 6,
  IMPORTANT: 5,
  WATCH: 4,
  INFO: 3.2,
  NOISE: 2.6,
}

/** 30fps. Nothing here moves fast enough to need more, and it halves the cost. */
const FRAME_MS = 1000 / 30

export function AttentionField({
  points,
  budget,
  height = 168,
}: {
  points: FieldPoint[]
  /** The attention budget, for the label beside the line. */
  budget: number
  height?: number
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || points.length === 0) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    /*
     * The field is scaled to the scores actually present, not to zero.
     *
     * Scaling from zero looked correct and read badly: a watchlist whose
     * scores run 84 down to 30 left the bottom third of the field empty and
     * squashed every point into the top, which makes the gaps between names -
     * the thing the picture is for - almost invisible. Anchoring to the range
     * spends the whole field on the comparison being made.
     */
    const scores = points.map((p) => p.score)
    const hi = Math.max(...scores)
    const lo = Math.min(...scores)
    const span = hi - lo
    const TOP = 0.08
    const BOTTOM = 0.92

    // A watchlist where every score is identical has no vertical story to
    // tell. Placing them on one line is the honest rendering of that.
    const place = (score: number) =>
      span === 0 ? 0.5 : TOP + (1 - (score - lo) / span) * (BOTTOM - TOP)

    const lowestSurfaced = points.filter((p) => p.surfaced).at(-1)?.score ?? lo

    // Laid out once. Horizontal position is the index, so the field is stable
    // between renders rather than reshuffling on every paint.
    const laid = points.map((p, i) => ({
      ...p,
      fx: points.length === 1 ? 0.5 : i / (points.length - 1),
      fy: place(p.score),
      // A per-point phase, so they drift independently instead of pulsing as
      // one organism.
      phase: (i * 2.399) % (Math.PI * 2),
    }))

    let raf = 0
    let last = 0
    let running = true

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const rect = canvas!.getBoundingClientRect()
      canvas!.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas!.height = Math.max(1, Math.floor(height * dpr))
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    function draw(t: number) {
      const rect = canvas!.getBoundingClientRect()
      const w = rect.width
      const h = height
      const padX = 18
      const padY = 22
      const innerW = Math.max(1, w - padX * 2)
      const innerH = Math.max(1, h - padY * 2)

      ctx!.clearRect(0, 0, w, h)

      // The budget line. Positioned at the lowest score that still made the
      // brief, which is where the cut actually fell. Nudged down half a point
      // radius so it reads as beneath the last surfaced name rather than
      // through it.
      const lineY = padY + place(lowestSurfaced) * innerH + 7
      ctx!.save()
      ctx!.strokeStyle = 'rgba(224,163,61,0.34)'
      ctx!.lineWidth = 1
      ctx!.setLineDash([3, 5])
      ctx!.beginPath()
      ctx!.moveTo(padX, lineY)
      ctx!.lineTo(w - padX, lineY)
      ctx!.stroke()
      ctx!.restore()

      // Right-aligned and below the line. On the left it sat exactly where the
      // top-ranked names do, and the label printed straight through them.
      ctx!.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx!.fillStyle = 'rgba(224,163,61,0.75)'
      ctx!.textAlign = 'right'
      ctx!.textBaseline = 'top'
      ctx!.fillText(`ATTENTION BUDGET · ${budget}`, w - padX, lineY + 4)
      ctx!.textAlign = 'left'

      for (const p of laid) {
        // A slow vertical drift. Purely visual, and small enough that it never
        // moves a point across the budget line.
        const drift = reduced ? 0 : Math.sin(t / 2600 + p.phase) * 2.4
        const x = padX + p.fx * innerW
        const y = padY + p.fy * innerH + drift

        const color = SEV_COLOR[p.severity]
        const r = SEV_RADIUS[p.severity]

        // Surfaced points carry a glow; held-back ones do not. The difference
        // is the whole message, so it is deliberately large.
        if (p.surfaced && !p.snoozed) {
          const glow = ctx!.createRadialGradient(x, y, 0, x, y, r * 4)
          glow.addColorStop(0, `${color}55`)
          glow.addColorStop(1, `${color}00`)
          ctx!.fillStyle = glow
          ctx!.beginPath()
          ctx!.arc(x, y, r * 4, 0, Math.PI * 2)
          ctx!.fill()
        }

        ctx!.beginPath()
        ctx!.arc(x, y, r, 0, Math.PI * 2)

        if (p.snoozed) {
          // Hollow: still there, deliberately quiet.
          ctx!.strokeStyle = `${color}88`
          ctx!.lineWidth = 1.25
          ctx!.stroke()
        } else {
          ctx!.fillStyle = p.surfaced ? color : `${color}55`
          ctx!.fill()
        }

        // Only the surfaced names are labelled. Labelling everything would turn
        // the picture back into the list it is meant to replace.
        if (p.surfaced && !p.snoozed) {
          ctx!.font =
            '9px ui-monospace, SFMono-Regular, Menlo, monospace'
          ctx!.fillStyle = 'rgba(232,235,240,0.7)'
          ctx!.textAlign = 'center'
          ctx!.textBaseline = 'bottom'
          ctx!.fillText(p.symbol, x, y - r - 5)
          ctx!.textAlign = 'left'
        }
      }
    }

    function frame(t: number) {
      if (!running) return
      if (t - last >= FRAME_MS) {
        last = t
        draw(t)
      }
      raf = requestAnimationFrame(frame)
    }

    resize()

    /*
     * Paint once, immediately and unconditionally.
     *
     * The drift used to be the only thing that ever painted, which made the
     * picture hostage to the animation loop actually starting — and on a
     * narrow viewport it did not: the observer reported the canvas off-screen
     * while the page was still settling, cleared the `running` flag, and then
     * never reported a *change* back to on-screen, so the restart branch was
     * unreachable and the field rendered as empty space.
     *
     * A static frame here is not a fallback. The picture is the deliverable;
     * the drift is decoration on top of it, and decoration must never be the
     * thing that decides whether the data appears.
     */
    draw(0)

    /**
     * Start or stop the loop, idempotently.
     *
     * Always cancels before scheduling, so a stray pending frame can never
     * leave two loops running, and the decision is made from the argument
     * rather than from a flag that has to be kept in step with the browser.
     */
    function setRunning(next: boolean) {
      cancelAnimationFrame(raf)
      running = next
      if (next && !reduced) raf = requestAnimationFrame(frame)
    }

    if (!reduced) setRunning(true)

    const onResize = () => {
      resize()
      draw(performance.now())
    }
    window.addEventListener('resize', onResize)

    // Stop entirely when scrolled away. An animation nobody can see is pure
    // cost — but stopping it must never be able to erase what is on screen,
    // which is why the static frame above is drawn first and never cleared.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (reduced) return
        setRunning(entry.isIntersecting)
      },
      { threshold: 0 },
    )
    io.observe(canvas)

    return () => {
      running = false
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      io.disconnect()
    }
  }, [points, budget, height])

  if (points.length === 0) return null

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={`Attention field: ${points.filter((p) => p.surfaced).length} of ${points.length} watched names surfaced above the attention budget`}
      className="w-full"
      style={{ height, display: 'block' }}
    />
  )
}
