'use client'

import { useEffect, useRef } from 'react'
import type { Severity } from '@/engine/types'

/**
 * The watchlist as a field in three dimensions, with the attention budget as a
 * plane cutting through it.
 *
 * This is the product's argument as a single image. Every name you watch is a
 * point standing on a ground grid; its HEIGHT is its attention score, and a
 * translucent plane sits at the height of the last name that made your brief.
 * A handful of points break the surface. Everything else sits underneath it,
 * dimmed — found, scored, and deliberately held back.
 *
 * **Most of the field is below the plane, and that is the point.** A watchlist
 * that surfaces everything has no opinion, and no summary sentence makes that
 * as immediate as seeing it.
 *
 * ## What is data and what is layout
 *
 * Exactly one axis carries meaning: **height is attention score.** The x and z
 * positions are a grid — layout, chosen so the field reads as a field, and
 * claiming nothing. That distinction is deliberate, and this note is here so
 * nobody later mistakes the arrangement for a measurement and starts reading
 * depth as significance. Colour and radius are severity; hollow is snoozed.
 * Nothing on screen is invented.
 *
 * ## How it is drawn
 *
 * A hand-rolled perspective projection onto a 2D canvas — yaw, pitch, and a
 * focal divide. No Three.js, no WebGL, no dependency: this is sixty lines of
 * trigonometry over a few dozen primitives, so a 3D library would cost more to
 * ship than the effect costs to compute.
 *
 * The camera drifts slowly and leans towards the cursor. Painter's algorithm
 * for depth, with the plane drawn between the points beneath it and the points
 * above it, so the surface genuinely occludes.
 *
 * Capped at 30fps, paused off-screen, and — the lesson from the last round —
 * **painted once, unconditionally, before any loop exists.** Decoration must
 * never be the thing that decides whether the data appears.
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
  CRITICAL: 6.5,
  IMPORTANT: 5.5,
  WATCH: 4.4,
  INFO: 3.6,
  NOISE: 3,
}

/** 30fps. Nothing here moves fast enough to need more, and it halves the cost. */
const FRAME_MS = 1000 / 30

/** World-space size of the ground plane, in the same units as the heights. */
const SPAN = 220
/**
 * How tall the highest score stands above the ground.
 *
 * Tuned against the frame, not chosen for drama: at 96 the tallest stems ran
 * off the top of the canvas and the names that matter most were the ones
 * getting cropped.
 */
const RISE = 70
/**
 * Focal length, as a fraction of the canvas width.
 *
 * Proportional rather than fixed. A constant focal length meant the scene was
 * framed for exactly one canvas width and under-filled every other: on a wide
 * brief it sat as a small diagram in the middle of a lot of empty space, and
 * on a narrow one it ran to the edges. Tying it to the width keeps the framing
 * identical at any size, which is the only version that survives a resize.
 */
const FOCAL_RATIO = 1.05
/** How far the camera sits back from the middle of the field. */
const DOLLY = 340

/**
 * How far the pointer may swing the camera, in radians.
 *
 * Shared by the fit and by the pointer handler, because the fit has to frame
 * the scene at the extremes of the lean — and if these two numbers were
 * written separately they would drift, and the drift would show up as labels
 * clipping only when someone moved the mouse to a corner.
 *
 * Kept modest for a second reason: the scene is scaled to fit its WIDEST
 * camera angle, so a bigger swing means a smaller picture at rest. Every extra
 * degree of lean is paid for by everything else being further away.
 */
const YAW_SWING = 0.28
const PITCH_SWING = 0.22
const YAW_REST = -0.5
const PITCH_REST = 0.42

interface Projected {
  sx: number
  sy: number
  /** Depth after rotation. Bigger is further away. */
  depth: number
  /** Perspective scale at that depth, for sizing whatever is drawn there. */
  k: number
}

export function AttentionField({
  points,
  budget,
  height = 260,
}: {
  points: FieldPoint[]
  /** The attention budget, for the label riding on the plane. */
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
     * Heights are scaled to the scores actually present, not to zero.
     *
     * Scaling from zero looks correct and reads badly: a watchlist whose
     * scores run 84 down to 30 leaves the bottom of the field empty and
     * flattens every point into one band — and the gaps between names are the
     * entire comparison being made.
     */
    const scores = points.map((p) => p.score)
    const hi = Math.max(...scores)
    const lo = Math.min(...scores)
    const spread = hi - lo
    const lift = (score: number) =>
      spread === 0 ? RISE * 0.5 : ((score - lo) / spread) * RISE

    // The plane sits at the lowest score that still made the brief — where the
    // cut actually fell, rather than a threshold guessed at again here.
    const lowestSurfaced = points.filter((p) => p.surfaced).at(-1)?.score ?? lo
    const planeY = lift(lowestSurfaced) - 3

    /*
     * A grid on the ground. Roughly square, so a watchlist of eleven and one of
     * forty both read as a field rather than as a line.
     *
     * This arrangement is LAYOUT, not data — see the note at the top.
     */
    const cols = Math.max(1, Math.ceil(Math.sqrt(points.length)))
    const rows = Math.ceil(points.length / cols)
    const step = SPAN / Math.max(cols, rows)

    const world = points.map((p, i) => {
      const gx = i % cols
      const gz = Math.floor(i / cols)
      return {
        ...p,
        x: (gx - (cols - 1) / 2) * step,
        z: (gz - (rows - 1) / 2) * step,
        y: lift(p.score),
        // A per-point phase, so the bob reads as a field breathing rather than
        // as one organism pulsing.
        phase: (i * 2.399) % (Math.PI * 2),
      }
    })

    // Camera. The `T` values are what the pointer asks for; the actuals chase
    // them, which is what makes the lean feel weighted instead of twitchy.
    let yaw = YAW_REST
    let pitch = PITCH_REST
    let yawT = YAW_REST
    let pitchT = PITCH_REST

    let raf = 0
    let last = 0
    let running = false
    let w = 0

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const rect = canvas!.getBoundingClientRect()
      w = rect.width
      canvas!.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas!.height = Math.max(1, Math.floor(height * dpr))
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      computeFit()
    }

    /*
     * Auto-fit.
     *
     * Every constant in this file was at some point hand-tuned so the scene
     * happened to fit the frame — and each time, a different watchlist or a
     * different canvas width put a point back off the top. Framing by constant
     * only ever works for the case it was tuned against.
     *
     * So the scene measures itself instead. `computeFit` projects the whole
     * field at the camera's resting angle AND at both extremes of the pointer
     * lean, takes the vertical extent including the room the labels need, and
     * solves for a scale and offset that fit it with a margin. Recomputed on
     * resize only, so it is stable while the camera moves — a fit recomputed
     * per frame would breathe as points bobbed, which is worse than clipping.
     */
    let fitScale = 1
    let fitBias = height * 0.74
    /*
     * Horizontal origin, measured rather than assumed.
     *
     * Centring the WORLD origin is not the same as centring the picture: the
     * camera is yawed, so the projected field lands off to one side of it and
     * the scene sat left with a band of empty canvas to its right. The fit
     * solves for where the drawing actually is.
     */
    let fitBiasX = 0
    /** Room above a point for its label, and the margin at the frame edges. */
    const LABEL_HEAD = 20
    const PAD = 8

    /** World space to screen. Yaw about Y, pitch about X, then a focal divide. */
    function project(x: number, y: number, z: number): Projected {
      const cy = Math.cos(yaw)
      const sy = Math.sin(yaw)
      const rx = x * cy - z * sy
      const rz = x * sy + z * cy

      const cp = Math.cos(pitch)
      const sp = Math.sin(pitch)
      const ry = y * cp - rz * sp
      const rzz = y * sp + rz * cp

      const depth = rzz + DOLLY
      const k = (w * FOCAL_RATIO) / Math.max(1, depth)

      return {
        sx: fitBiasX + rx * k * fitScale,
        sy: fitBias - ry * k * fitScale,
        depth,
        k: k * fitScale,
      }
    }

    /** Solve `fitScale` and `fitBias` so the whole scene sits inside the frame. */
    function computeFit() {
      const savedYaw = yaw
      const savedPitch = pitch
      // Measure in raw projected offsets from the origin: scale 1, no bias.
      fitScale = 1
      fitBias = 0
      fitBiasX = 0

      let top = Infinity
      let bottom = -Infinity
      let left = Infinity
      let right = -Infinity

      // The corners of the pointer lean as well as the rest position, so
      // swinging the camera can never push a point out of frame either.
      const cameras: Array<[number, number]> = [
        [YAW_REST, PITCH_REST],
        [YAW_REST - YAW_SWING, PITCH_REST - PITCH_SWING],
        [YAW_REST - YAW_SWING, PITCH_REST + PITCH_SWING],
        [YAW_REST + YAW_SWING, PITCH_REST - PITCH_SWING],
        [YAW_REST + YAW_SWING, PITCH_REST + PITCH_SWING],
      ]

      const half = SPAN / 2
      const corners: Array<[number, number, number]> = [
        [-half, 0, -half],
        [half, 0, -half],
        [half, 0, half],
        [-half, 0, half],
      ]

      for (const cam of cameras) {
        yaw = cam[0]
        pitch = cam[1]

        for (const p of world) {
          const q = project(p.x, p.y, p.z)

          /*
           * A point is bigger than its centre.
           *
           * Measuring centres alone is what let the scene clip after it was
           * supposedly solved: a surfaced point carries a glow drawn out to
           * five times its radius, so the visible mark extends far past the
           * coordinate being framed. Padding to 3r covers the part of that
           * halo which is actually visible: the gradient falls linearly from
           * 40% alpha, so by 2.6r it is under the 50/255 the framing test
           * treats as ink, and 3r leaves margin over that. Framing the full
           * 5r asymptote would shrink the whole scene to accommodate pixels
           * nobody can perceive.
           */
          const glow = p.surfaced ? SEV_RADIUS[p.severity] * 3 * q.k : 0
          const above = Math.max(glow, LABEL_HEAD)

          top = Math.min(top, q.sy - above)
          bottom = Math.max(bottom, q.sy + glow)
          // Symbols are drawn centred on their point, so allow half a label
          // either side as well as the halo.
          const side = Math.max(glow, 26)
          left = Math.min(left, q.sx - side)
          right = Math.max(right, q.sx + side)
        }

        // The ground corners, so the grid is framed too — and the plane's
        // caption, which hangs below the lowest one.
        for (const c of corners) {
          const q = project(c[0], c[1], c[2])
          top = Math.min(top, q.sy)
          bottom = Math.max(bottom, q.sy + LABEL_HEAD)
          left = Math.min(left, q.sx)
          right = Math.max(right, q.sx)
        }
      }

      yaw = savedYaw
      pitch = savedPitch

      // Whichever axis runs out first decides the scale. Fitting only the
      // vertical would let a wide watchlist run off the sides instead.
      const vExtent = Math.max(1, bottom - top)
      const hExtent = Math.max(1, right - left)

      // Never scale past 1: the constants are chosen for a legible dot size,
      // and blowing the scene up would only make it coarse.
      fitScale = Math.min(
        1,
        (height - PAD * 2) / vExtent,
        (w - PAD * 2) / hExtent,
      )
      // Centred in the leftover space rather than pinned to the top, which
      // left the field hanging off the ceiling with a band of dead canvas
      // underneath it.
      const slack = height - PAD * 2 - vExtent * fitScale
      fitBias = PAD + slack / 2 - top * fitScale
      fitBiasX = (w - hExtent * fitScale) / 2 - left * fitScale
    }

    function line(
      a: [number, number, number],
      b: [number, number, number],
      stroke: string,
    ) {
      const p1 = project(a[0], a[1], a[2])
      const p2 = project(b[0], b[1], b[2])
      ctx!.strokeStyle = stroke
      ctx!.lineWidth = 1
      ctx!.beginPath()
      ctx!.moveTo(p1.sx, p1.sy)
      ctx!.lineTo(p2.sx, p2.sy)
      ctx!.stroke()
    }

    /** The ground: a faint wireframe, so the perspective is legible at all. */
    function drawGround() {
      const half = SPAN / 2
      const divisions = 8
      for (let i = 0; i <= divisions; i++) {
        const t = -half + (i / divisions) * SPAN
        const edge = i === 0 || i === divisions
        const stroke = edge ? 'rgba(120,132,150,0.16)' : 'rgba(120,132,150,0.07)'
        line([t, 0, -half], [t, 0, half], stroke)
        line([-half, 0, t], [half, 0, t], stroke)
      }
    }

    /**
     * The budget plane.
     *
     * Filled faintly, outlined in the accent, with the label riding on whichever
     * edge is nearest the viewer. This is the one surface in the scene that
     * means something, so it is the only one that gets the accent colour.
     */
    function drawPlane() {
      const half = SPAN / 2
      const corners: Array<[number, number, number]> = [
        [-half, planeY, -half],
        [half, planeY, -half],
        [half, planeY, half],
        [-half, planeY, half],
      ]
      const pts = corners.map((c) => project(c[0], c[1], c[2]))

      ctx!.beginPath()
      ctx!.moveTo(pts[0].sx, pts[0].sy)
      for (let i = 1; i < pts.length; i++) ctx!.lineTo(pts[i].sx, pts[i].sy)
      ctx!.closePath()
      ctx!.fillStyle = 'rgba(224,163,61,0.055)'
      ctx!.fill()
      ctx!.strokeStyle = 'rgba(224,163,61,0.4)'
      ctx!.lineWidth = 1
      ctx!.stroke()

      // Which corner is nearest changes as the camera turns, so the label
      // follows the lowest one on screen rather than a fixed index.
      const near = pts.reduce((a, b) => (b.sy > a.sy ? b : a))
      const text = `ATTENTION BUDGET · ${budget}`
      ctx!.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx!.textAlign = 'center'
      ctx!.textBaseline = 'top'

      // A plate behind the text. Over a wireframe the label was competing with
      // grid lines and losing; this is the one string on the canvas that has to
      // be readable, because it names what the surface IS.
      const tw = ctx!.measureText(text).width
      ctx!.fillStyle = 'rgba(11,13,17,0.82)'
      ctx!.beginPath()
      ctx!.roundRect(near.sx - tw / 2 - 6, near.sy + 3, tw + 12, 15, 3)
      ctx!.fill()

      ctx!.fillStyle = 'rgba(240,197,116,0.95)'
      ctx!.fillText(text, near.sx, near.sy + 6)
      ctx!.textAlign = 'left'
    }

    function drawPoint(p: (typeof world)[number], projected: Projected) {
      const sx = projected.sx
      const sy = projected.sy
      const k = projected.k
      const color = SEV_COLOR[p.severity]
      const r = Math.max(1.2, SEV_RADIUS[p.severity] * k)

      // The stem, from the ground up to the point. It is what makes a height
      // readable AS a height rather than as a position on a flat picture.
      const base = project(p.x, 0, p.z)
      ctx!.strokeStyle = p.surfaced
        ? `${color}${p.snoozed ? '33' : '55'}`
        : `${color}3a`
      ctx!.lineWidth = Math.max(0.6, 1.1 * k)
      ctx!.beginPath()
      ctx!.moveTo(base.sx, base.sy)
      ctx!.lineTo(sx, sy)
      ctx!.stroke()

      // A contact shadow where the stem meets the ground. One ellipse, and it
      // stops the points looking as though they hover over nothing.
      ctx!.fillStyle = 'rgba(0,0,0,0.35)'
      ctx!.beginPath()
      ctx!.ellipse(base.sx, base.sy, r * 1.5, r * 0.5, 0, 0, Math.PI * 2)
      ctx!.fill()

      // Surfaced points glow; held-back ones do not. That difference is the
      // whole message, so it is deliberately large.
      if (p.surfaced && !p.snoozed) {
        const glow = ctx!.createRadialGradient(sx, sy, 0, sx, sy, r * 5)
        glow.addColorStop(0, `${color}66`)
        glow.addColorStop(1, `${color}00`)
        ctx!.fillStyle = glow
        ctx!.beginPath()
        ctx!.arc(sx, sy, r * 5, 0, Math.PI * 2)
        ctx!.fill()
      }

      ctx!.beginPath()
      ctx!.arc(sx, sy, r, 0, Math.PI * 2)
      if (p.snoozed) {
        // Hollow: still there, deliberately quiet.
        ctx!.strokeStyle = `${color}99`
        ctx!.lineWidth = Math.max(0.8, 1.3 * k)
        ctx!.stroke()
      } else {
        // Held-back points are dimmed, not hidden. At 0x55 they were so close
        // to the ground colour that the field looked like five names floating
        // over nothing — which argues the opposite of what the picture is for.
        ctx!.fillStyle = p.surfaced ? color : `${color}96`
        ctx!.fill()
        if (p.surfaced) {
          // A specular nick, offset up and left. One arc, and it is the
          // difference between a disc and a sphere.
          ctx!.fillStyle = 'rgba(255,255,255,0.5)'
          ctx!.beginPath()
          ctx!.arc(sx - r * 0.3, sy - r * 0.3, r * 0.3, 0, Math.PI * 2)
          ctx!.fill()
        }
      }

      // Only the surfaced names are labelled. Labelling everything would turn
      // the picture back into the list it exists to replace.
      if (p.surfaced && !p.snoozed) {
        const size = Math.max(7, Math.min(11, 10 * k))
        ctx!.font = `${size}px ui-monospace, SFMono-Regular, Menlo, monospace`
        ctx!.fillStyle = `rgba(232,235,240,${Math.min(0.92, 0.45 + k * 0.5)})`
        ctx!.textAlign = 'center'
        ctx!.textBaseline = 'bottom'
        ctx!.fillText(p.symbol, sx, sy - r - 5)
        ctx!.textAlign = 'left'
      }
    }

    function draw(t: number) {
      ctx!.clearRect(0, 0, w, height)

      // Ease the camera towards where the pointer asked it to go. A plain lerp,
      // which reads as weight without needing a spring solver.
      yaw += (yawT - yaw) * 0.06
      pitch += (pitchT - pitch) * 0.06

      // A slow drift on top, so the scene is alive when nobody is touching it.
      const settled = yaw
      yaw += reduced ? 0 : Math.sin(t / 5200) * 0.16

      drawGround()

      // Painter's algorithm, with the plane in the middle of the stack: points
      // beneath the surface, then the surface, then the points above it. That
      // ordering is what makes the plane genuinely occlude rather than float
      // over everything.
      const projected = world.map((p) => {
        const bob = reduced ? 0 : Math.sin(t / 2400 + p.phase) * 1.6
        return { p, proj: project(p.x, p.y + bob, p.z) }
      })
      projected.sort((a, b) => b.proj.depth - a.proj.depth)

      for (const item of projected) {
        if (item.p.y > planeY) continue
        drawPoint(item.p, item.proj)
      }

      drawPlane()

      for (const item of projected) {
        if (item.p.y <= planeY) continue
        drawPoint(item.p, item.proj)
      }

      yaw = settled
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
     * The motion used to be the only thing that ever painted, which made the
     * picture hostage to the animation loop actually starting — and on a narrow
     * viewport it did not: the observer reported the canvas off-screen while
     * the page was still settling, cleared the running flag, and then never
     * reported a *change* back, so the restart branch was unreachable and the
     * field rendered as empty space.
     *
     * A static frame here is not a fallback. The picture is the deliverable;
     * the motion is decoration on top of it, and decoration must never be the
     * thing that decides whether the data appears.
     */
    draw(0)

    /** Start or stop the loop, idempotently. Always cancels before scheduling. */
    function setRunning(next: boolean) {
      cancelAnimationFrame(raf)
      running = next
      if (next && !reduced) raf = requestAnimationFrame(frame)
    }

    if (!reduced) setRunning(true)

    /*
     * The camera leans towards the cursor.
     *
     * Skipped entirely under reduced motion. A pointer lean is motion the
     * viewer did not ask for just as much as the drift is, and a scene that
     * holds still until you touch it and then swings is worse than one that
     * never moves at all.
     */
    function onPointer(e: PointerEvent) {
      if (reduced) return
      const rect = canvas!.getBoundingClientRect()
      const nx = (e.clientX - rect.left) / rect.width - 0.5
      const ny = (e.clientY - rect.top) / rect.height - 0.5
      yawT = YAW_REST + nx * 2 * YAW_SWING
      pitchT = PITCH_REST + ny * 2 * PITCH_SWING
    }

    function onLeave() {
      yawT = YAW_REST
      pitchT = PITCH_REST
    }

    canvas.addEventListener('pointermove', onPointer)
    canvas.addEventListener('pointerleave', onLeave)

    const onResize = () => {
      resize()
      draw(performance.now())
    }
    window.addEventListener('resize', onResize)

    // Stop entirely when scrolled away. An animation nobody can see is pure
    // cost — but stopping it must never erase what is on screen, which is why
    // the static frame above is drawn first and nothing ever clears it.
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
      canvas.removeEventListener('pointermove', onPointer)
      canvas.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('resize', onResize)
      io.disconnect()
    }
  }, [points, budget, height])

  if (points.length === 0) return null

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={`Attention field: ${points.filter((p) => p.surfaced).length} of ${points.length} watched names stand above the attention budget`}
      className="w-full cursor-crosshair"
      style={{ height, display: 'block', touchAction: 'pan-y' }}
    />
  )
}
