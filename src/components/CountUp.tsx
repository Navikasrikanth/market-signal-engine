'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * A number that arrives rather than appears.
 *
 * Deliberately conservative about where this is used. Animating a *price* would
 * be dishonest — for a few hundred milliseconds the screen would be showing a
 * figure that is not the figure, and a reader who glances away at the wrong
 * moment reads a wrong number off a financial product. So this is for
 * attention scores and counts only: internal quantities, unbounded by nothing
 * but the engine, where an intermediate value misleads nobody.
 *
 * Short (600ms), eased out, and tabular so the width never changes as digits
 * cycle. Under reduced motion it renders the final value on the first frame and
 * never starts a loop.
 */
export function CountUp({
  value,
  duration = 600,
  className,
}: {
  value: number
  duration?: number
  className?: string
}) {
  // Start at the final value. If the effect never runs — reduced motion, an
  // environment without rAF, or a server render — the correct number is what
  // was on screen the whole time.
  const [shown, setShown] = useState(value)
  const ref = useRef(value)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value)
      ref.current = value
      return
    }

    const from = ref.current
    const delta = value - from
    if (delta === 0) return

    let raf = 0
    const start = performance.now()

    function step(now: number) {
      const t = Math.min(1, (now - start) / duration)
      // Same decelerating feel as the CSS easing token, so motion in this app
      // has one character rather than several.
      const eased = 1 - Math.pow(1 - t, 3)
      setShown(Math.round(from + delta * eased))
      if (t < 1) raf = requestAnimationFrame(step)
      else ref.current = value
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])

  return <span className={`num ${className ?? ''}`}>{shown}</span>
}
