import type { Severity } from '@/engine/types'
import { CountUp } from './CountUp'

/**
 * Small shared pieces. Kept together because each is a few lines and they are
 * always used in combination on a card.
 */

/**
 * The severity ramp, as colour and as weight.
 *
 * `tint` is the same hue at low alpha, used as a fill. Written out rather than
 * derived with `color-mix` so the value is greppable and so the chip renders
 * identically in browsers that do not support it.
 */
const SEVERITY_STYLE: Record<
  Severity,
  { label: string; color: string; tint: string }
> = {
  CRITICAL: {
    label: 'CRITICAL',
    color: 'var(--sev-critical)',
    tint: 'rgb(229 100 90 / 0.16)',
  },
  IMPORTANT: {
    label: 'IMPORTANT',
    color: 'var(--sev-important)',
    tint: 'rgb(224 163 61 / 0.15)',
  },
  WATCH: {
    label: 'WATCH',
    color: 'var(--sev-watch)',
    tint: 'rgb(90 169 201 / 0.14)',
  },
  INFO: { label: 'INFO', color: 'var(--sev-info)', tint: 'rgb(138 147 160 / 0.13)' },
  NOISE: {
    label: 'QUIET',
    color: 'var(--sev-noise)',
    tint: 'rgb(74 82 95 / 0.16)',
  },
}

/**
 * Filled rather than outlined, so severity reads at a glance across a column
 * of cards instead of needing to be looked at.
 *
 * Only CRITICAL glows. A glow on every chip is a gradient on every chip, which
 * is no signal at all — the whole product is an argument about spending
 * attention where it is warranted, and the chrome should not contradict it.
 */
export function SeverityChip({ severity }: { severity: Severity }) {
  const s = SEVERITY_STYLE[severity]
  return (
    <span
      className="rounded-[var(--r-sm)] border px-1.5 py-0.5 font-mono text-[10px] tracking-wider"
      style={{
        color: s.color,
        borderColor: s.color,
        background: s.tint,
        boxShadow:
          severity === 'CRITICAL'
            ? '0 0 12px -2px rgb(229 100 90 / 0.45)'
            : undefined,
      }}
    >
      {s.label}
    </span>
  )
}

/**
 * Freshness is a required prop, not an optional decoration.
 *
 * There is deliberately no way to render a price in this app without also
 * saying how old it is and whether two sources agreed on it. Showing a stale or
 * disputed number as though it were live is the failure mode that matters most
 * here, so the type system makes it awkward to do.
 */
export function FreshnessDot({
  asOf,
  confirmed,
  confidence,
}: {
  asOf: string
  confirmed: boolean
  confidence: number
}) {
  const ageHours = asOf
    ? (Date.now() - new Date(asOf).getTime()) / 3_600_000
    : Infinity

  let color = 'var(--up)'
  let title = 'Fresh, confirmed by two sources'

  if (!confirmed) {
    color = 'var(--accent)'
    title = 'Two sources disagree on this price — treat as provisional'
  } else if (confidence < 1) {
    color = 'var(--sev-info)'
    title = `Only one source reported this price — uncorroborated, but not disputed (confidence ${Math.round(confidence * 100)}%)`
  } else if (ageHours > 96) {
    color = 'var(--sev-noise)'
    title = `Stale — last updated ${Math.round(ageHours / 24)} days ago`
  } else if (ageHours > 24) {
    color = 'var(--sev-info)'
    title = `Delayed — last updated ${Math.round(ageHours)}h ago`
  }

  return (
    <span
      className="inline-block size-1.5 shrink-0 rounded-full align-middle"
      style={{ background: color }}
      title={title}
      aria-label={title}
    />
  )
}

export function Money({
  value,
  asOf,
  confirmed,
  confidence,
}: {
  value: number
  asOf: string
  confirmed: boolean
  confidence: number
}) {
  return (
    <span className="tabular inline-flex items-center gap-1.5">
      <FreshnessDot asOf={asOf} confirmed={confirmed} confidence={confidence} />
      ${value.toFixed(2)}
    </span>
  )
}

export function Change({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-[color:var(--ink-3)]">—</span>
  const up = pct >= 0
  return (
    <span
      className="tabular font-medium"
      style={{ color: up ? 'var(--up)' : 'var(--down)' }}
    >
      {up ? '+' : ''}
      {(pct * 100).toFixed(1)}%
    </span>
  )
}

/**
 * Inline SVG sparkline. No charting library: this is a handful of points and a
 * path, and a dependency for it would cost more than it saves.
 *
 * Three things beyond the polyline it started as: the stroke runs through a
 * gradient so the recent end is the brighter end, an area fill fades away
 * beneath it to give the line a floor, and the endpoint carries a soft halo
 * because the endpoint is the value that matters.
 *
 * The draw-in is a pure CSS `stroke-dasharray` animation rather than anything
 * driven from JavaScript, so it costs one composited property and is collapsed
 * by the global reduced-motion rule without this component knowing about it.
 */
export function Sparkline({
  points,
  width = 96,
  height = 28,
  animate = true,
}: {
  points: number[]
  width?: number
  height?: number
  /** Off inside dense lists, where a dozen lines drawing at once is noise. */
  animate?: boolean
}) {
  if (points.length < 2) return <svg width={width} height={height} />

  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1
  const step = width / (points.length - 1)

  const at = (p: number, i: number) => ({
    x: i * step,
    y: height - ((p - min) / range) * (height - 4) - 2,
  })

  const d = points
    .map((p, i) => {
      const { x, y } = at(p, i)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  // The same path, closed along the bottom edge. Filled with a fading gradient
  // so the line has weight without the fill competing with it.
  const area = `${d} L${width},${height} L0,${height} Z`

  const rising = points[points.length - 1] >= points[0]
  const stroke = rising ? 'var(--up)' : 'var(--down)'
  const last = at(points[points.length - 1], points.length - 1)

  /*
   * SVG ids are document-global, so a dozen sparklines on one page cannot each
   * invent their own gradient id without either colliding or needing a hook.
   * `useId` would solve it and would also make this module client-only, which
   * it is not - server pages render sparklines directly.
   *
   * There are only ever two gradients on the page: a rising one and a falling
   * one. Naming them by direction makes duplicate <defs> harmless (identical
   * definitions, first one wins) and removes the collision entirely, because
   * every line that shares an id genuinely wants the same colours.
   */
  const dir = rising ? 'up' : 'down'

  // An over-estimate of the path length. Exact would need `getTotalLength`,
  // which needs a DOM node and a layout pass; too long simply means the line
  // starts drawing a fraction later, which nobody can see.
  const len = Math.ceil(width * 2)

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className="overflow-visible"
    >
      <defs>
        <linearGradient id={`spark-line-${dir}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="1" />
        </linearGradient>
        <linearGradient id={`spark-area-${dir}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>

      <path d={area} fill={`url(#spark-area-${dir})`} stroke="none" />
      <path
        d={d}
        fill="none"
        stroke={`url(#spark-line-${dir})`}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={
          animate
            ? {
                strokeDasharray: len,
                strokeDashoffset: len,
                animation: `draw 900ms var(--ease-out) forwards`,
              }
            : undefined
        }
      />

      {/* The halo, then the dot. Two circles rather than a filter, because a
          blur filter on a dozen sparklines is a real cost and this is not. */}
      <circle cx={last.x} cy={last.y} r="4" fill={stroke} opacity="0.22" />
      <circle cx={last.x} cy={last.y} r="2" fill={stroke} />
    </svg>
  )
}

/**
 * The score, counted up on arrival.
 *
 * Safe to animate precisely because it is not a price: it is an internal
 * ranking quantity, so an intermediate value on the way to it cannot be
 * misread as a fact about the market.
 */
export function AttentionScore({ score }: { score: number }) {
  return (
    <div className="flex flex-col items-end leading-none">
      <CountUp value={score} className="text-2xl font-semibold" />
      <span className="font-mono text-[9px] tracking-wider text-[color:var(--ink-3)]">
        ATTENTION
      </span>
    </div>
  )
}
