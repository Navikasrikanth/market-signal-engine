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
    el.style.setProperty('--mx', `${x}%`)
    el.style.setProperty('--my', `${y}%`)
    if (motionAllowed()) {
      // The lift is part of this transform rather than a `.card-lift` hover
      // rule. An inline transform wins over a stylesheet one, so a card that
      // used both would silently lose its elevation the moment the pointer
      // moved.
      el.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-2px)`
    }
  }

  function onMove(e: React.PointerEvent<HTMLElement>) {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height
    next.current = {
      x: px * 100,
      y: py * 100,
      // Inverted on X so the card leans towards the cursor rather than away.
      rx: (0.5 - py) * 1.2,
      ry: (px - 0.5) * 1.2,
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

  return (
    <Tag
      ref={ref as never}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={`spotlight ${className ?? ''}`}
      style={{ transformStyle: 'preserve-3d' }}
    >
      {children}
    </Tag>
  )
}
