'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * Sign out, from wherever you happen to be.
 *
 * The endpoint worked from the day it was written and the control lived at the
 * bottom of the watchlist page, which meant that in practice there was no way
 * to sign out: nobody reading their brief goes to the watchlist to leave. A
 * feature nobody can find is not shipped.
 */
export function SignOut() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function signOut() {
    setBusy(true)
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' })
      if (!res.ok) throw new Error(String(res.status))

      // Refresh BEFORE navigating. `push` alone can serve a cached RSC payload
      // for a route rendered while the session still existed, so the brief
      // flashes back before the redirect catches up.
      router.refresh()
      router.push('/login')
    } catch {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={busy}
      className="font-mono text-[10px] tracking-wide text-[color:var(--ink-3)] underline decoration-dotted underline-offset-4 hover:text-[color:var(--accent-ink)] disabled:opacity-50"
    >
      {busy ? 'signing out…' : 'sign out'}
    </button>
  )
}
