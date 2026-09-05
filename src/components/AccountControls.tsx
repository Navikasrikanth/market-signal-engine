'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

/**
 * Sign out, and adjust how much the brief will show.
 *
 * Both endpoints existed before this component did and nothing called them —
 * a user could not sign out at all, and the attention budget was read from
 * user settings while being settable only by editing the database.
 *
 * The budget is the one control that changes what the product *does*. A filter
 * whose severity you cannot adjust is one you either accept or abandon.
 */
export function AccountControls({ budget }: { budget: number }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [value, setValue] = useState(budget)
  const [error, setError] = useState<string | null>(null)

  async function post(url: string, body?: unknown, method = 'POST') {
    setError(null)
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!res.ok) {
      setError('That did not work. Try again.')
      return false
    }
    return true
  }

  async function changeBudget(next: number) {
    setValue(next)
    if (await post('/api/settings', { attentionBudget: next }, 'PATCH')) {
      startTransition(() => router.refresh())
    } else {
      setValue(budget)
    }
  }

  async function rewind(days: number) {
    if (await post('/api/watch-state/rewind', { days })) {
      startTransition(() => router.push('/'))
    }
  }

  async function signOutEverywhere() {
    if (await post('/api/auth/logout-all')) {
      // Refresh before navigating: `push` alone can serve an RSC payload
      // rendered while the session still existed.
      router.refresh()
      startTransition(() => router.push('/login'))
    }
  }

  return (
    <section className="glass rounded-[var(--r-lg)] p-4">
      <h2 className="meta mb-3">YOUR BRIEF</h2>

      <label className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-[color:var(--ink-2)]">Show at most</span>
        <select
          // Named explicitly. The surrounding text reads as a sentence, so the
          // control had no accessible name of its own and could only be found
          // by position - which broke the moment it moved up the page.
          aria-label="Names per brief"
          value={value}
          disabled={pending}
          onChange={(e) => void changeBudget(Number(e.target.value))}
          className="btn bg-[color:var(--surface-2)] px-2 py-1 text-xs text-[color:var(--ink)]"
        >
          {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="text-[color:var(--ink-2)]">names per brief</span>
      </label>

      <p className="mt-2 text-xs leading-relaxed text-[color:var(--ink-3)]">
        Anything the engine flags beyond this is reported as a count rather than
        hidden. Raising it does not find more; it only shows more of what was
        already found.
      </p>

      <div className="mt-4 border-t border-[color:var(--border)] pt-3">
        <p className="meta">SEE A LONGER WINDOW</p>
        <p className="mt-1 text-xs leading-relaxed text-[color:var(--ink-3)]">
          Set &ldquo;since you last looked&rdquo; further back. Useful when you
          were away longer than the product knows, or when you want the
          quarter rather than the week.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            { days: 7, label: 'a week' },
            { days: 30, label: 'a month' },
            { days: 75, label: '75 days' },
            { days: 180, label: 'six months' },
          ].map((o) => (
            <button
              key={o.days}
              type="button"
              disabled={pending}
              onClick={() => void rewind(o.days)}
              className="btn px-2.5 py-1 font-mono text-[11px] tracking-wide disabled:opacity-50"
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-[color:var(--ink-3)]">
          Moves the cursor backwards only. Pushing it forward would mark things
          seen that were never shown.
        </p>
      </div>

      {/*
        Ordinary sign-out lives in the header, on every page. Only the heavier
        action is here: revoking every session everywhere is a deliberate,
        occasional thing, and putting it a click from "sign out" invites the
        wrong one.
      */}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-[color:var(--border)] pt-3">
        <button
          type="button"
          onClick={() => void signOutEverywhere()}
          title="Revoke every session on every device"
          aria-label="Sign out everywhere"
          className="btn px-2.5 py-1 font-mono text-[11px] tracking-wide hover:!border-[color:var(--down)] hover:!text-[color:var(--down)]"
        >
          Sign out everywhere
        </button>
      </div>

      <p className="mt-2 text-xs text-[color:var(--ink-3)]">
        Signing out everywhere revokes every session on every device — the one
        control that matters if a password is exposed.
      </p>

      {error && (
        <p className="mt-2 text-xs" style={{ color: 'var(--down)' }}>
          {error}
        </p>
      )}
    </section>
  )
}
