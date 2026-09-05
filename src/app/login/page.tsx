import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { LoginForm } from '@/components/LoginForm'

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  if (await currentUser()) redirect('/')

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 py-16">
      {/* The sign-in panel floats on the mesh ground rather than sitting flat
          on it. It is the first surface anyone sees, and it should look like
          the product the rest of the app turns out to be. */}
      <div className="glass rise rounded-[var(--r-xl)] p-7">
        <span className="flex items-center gap-2">
          <Mark />
          <span className="font-mono text-[11px] tracking-[0.28em] text-[color:var(--accent-ink)]">
            SITREP
          </span>
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-[-0.02em]">
          Your market, since you last looked.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[color:var(--ink-3)]">
          A watchlist that tells you what meaningfully changed while you were
          away, why it matters, and what it decided not to bother you with.
        </p>

        <LoginForm />
      </div>
    </main>
  )
}

/** The same mark the shell uses: the attention budget, in miniature. */
function Mark() {
  return (
    <svg viewBox="0 0 20 20" className="size-5 shrink-0" aria-hidden>
      <rect x="3" y="3.5" width="9" height="2" rx="1" fill="var(--sev-critical)" />
      <rect x="3" y="8" width="6" height="2" rx="1" fill="var(--sev-important)" />
      <rect x="3" y="12.5" width="14" height="2" rx="1" fill="var(--sev-noise)" />
    </svg>
  )
}
