'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * Replay any window, not only the curated ones.
 *
 * The featured scenarios are shortcuts, and labelling them that way is the
 * honest framing: a demo that only works on two hand-picked dates invites
 * exactly one question. This runs the same pipeline over whatever range is
 * asked for.
 */
export function CustomRange({
  from,
  to,
  active,
}: {
  from: string | null
  to: string | null
  active: boolean
}) {
  const router = useRouter()
  const [start, setStart] = useState(from ?? '2022-01-03')
  const [end, setEnd] = useState(to ?? '2022-02-28')

  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        router.push(`/replay?from=${start}&to=${end}`)
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] tracking-wider text-[color:var(--ink-3)]">
          FROM
        </span>
        <input
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface-2)] px-2 py-1 text-xs text-[color:var(--ink)]"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] tracking-wider text-[color:var(--ink-3)]">
          TO
        </span>
        <input
          type="date"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className="rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface-2)] px-2 py-1 text-xs text-[color:var(--ink)]"
        />
      </label>

      <button
        type="submit"
        className="rounded-md border px-3 py-1.5 font-mono text-xs"
        style={
          active
            ? { borderColor: 'var(--accent)', color: 'var(--accent-ink)' }
            : { borderColor: 'var(--border-strong)', color: 'var(--ink-2)' }
        }
      >
        Replay this window
      </button>

      <p className="basis-full text-xs text-[color:var(--ink-3)]">
        Any range runs through the same pipeline as the featured examples —
        bars, features, detectors, scoring, themes, narrative. Nothing is
        special-cased around a named event.
      </p>
    </form>
  )
}
