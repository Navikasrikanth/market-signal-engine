'use client'

import { useRef } from 'react'

/**
 * A surface that knows where the cursor is.
 *
 * Two things happen on pointer move: a radial highlight follows the cursor, and
 * the card tilts a fraction of a degree towards it. Both are done by writing
 * CSS custom properties on the element — React never re-renders, and the
 * browser composites a gradient and a transform it was going to composite
 * anyway.
 *
 * Writes are coalesced into one animation frame. A pointermove handler that
 * touches the DOM on every event fires far more often than the screen
 * refreshes, and the extra work is invisible by definition.
 *
 * The tilt is 0.6° at the corners. Large enough to register as a response,
 * small enough that text never looks skewed — anything past about a degree
 * starts to read as a gimmick on a page of numbers.
 */
export function Spotlight({
  children,
  className,
  tilt = true,
  as: Tag = 'div',
}: {
  children: React.ReactNode
  className?: string
  tilt?: boolean
  as?: 'div' | 'article' | 'section'
}) {
  const ref = useRef<HTMLElement | null>(null)
  const queued = useRef(false)
  const next = useRef({ x: 0, y: 0, rx: 0, ry: 0 })

  /**
   * Reduced motion disables the tilt entirely.
   *
   * The global CSS rule collapses transitions, but an inline transform is not a
   * transition — it would simply apply instantly, which is worse. Read at the
   * moment of the event so a viewer changing the system setting is honoured
   * without a reload.
   */
  function motionAllowed() {
    return (
      tilt &&
      typeof window !== 'undefined' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
  }

  function flush() {
    queued.current = false
    const el = ref.current
    if (!el) return
    const { x, y, rx, ry } = next.current

    // Both the spotlight and the sheen read these, so one handler feeds two
    // effects and no card needs a second listener.
    el.style.setProperty('--mx', `${x}%`)
    el.style.setProperty('--my', `${y}%`)

    if (motionAllowed()) {
      /*
       * No `perspective()` in this transform.
       *
       * The perspective lives on the parent `.scene`, which is what makes the
       * depth real: a per-element `perspective()` function gives each card its
       * own vanishing point directly behind itself, so nothing inside can
       * parallax against anything else. Moving it to the ancestor means the
       * whole card — and every layer standing at its own Z inside it — is
       * projected through one camera.
       *
       * The lift is composed in here rather than left to a `.card-lift` hover
       * rule, because an inline transform beats a stylesheet one and the card
       * would otherwise lose its elevation the moment the pointer moved.
       */
      el.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) translateY(-4px) scale(1.008)`
    }
  }

  function onMove(e: React.PointerEvent<HTMLElement>) {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height

    // How far the card is allowed to lean, read from the token rather than
    // hardcoded, so the whole app's tilt is tuned in one place.
    const max =
      parseFloat(
        getComputedStyle(el).getPropertyValue('--tilt').trim().replace('deg', ''),
      ) || 7

    // Doubled, so `--tilt` is the angle reached at an EDGE rather than half of
    // it. Without this the token read as a maximum and delivered half — the
    // sort of quiet discrepancy that gets "fixed" later by doubling the number
    // instead of the maths.
    next.current = {
      x: px * 100,
      y: py * 100,
      // Inverted on X so the card leans towards the cursor rather than away.
      rx: (0.5 - py) * 2 * max,
      ry: (px - 0.5) * 2 * max,
    }
    if (!queued.current) {
      queued.current = true
      requestAnimationFrame(flush)
    }
  }

  function onLeave() {
    const el = ref.current
    if (!el) return
    el.style.transform = ''
  }

  /*
   * Two elements, not one.
   *
   * The perspective has to sit on an ancestor of the thing that rotates — put
   * both on the same element and the browser applies the projection before the
   * rotation, which flattens it. The outer div is the camera; the inner Tag is
   * what turns inside it.
   */
  return (
    <div className={tilt ? 'scene' : undefined}>
      <Tag
        ref={ref as never}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        className={`spotlight ${tilt ? 'tilt-3d sheen' : ''} ${className ?? ''}`}
      >
        {children}
      </Tag>
    </div>
  )
}
