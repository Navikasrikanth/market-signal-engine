import { timingSafeEqual } from 'node:crypto'
import { COMMON_PASSWORDS } from './common-passwords'

/**
 * Password and comparison rules, with no I/O.
 *
 * Split out of `auth.ts` for the same reason `src/engine` is pure: these are
 * the parts where a subtle mistake is invisible, so they have to be testable
 * without a database, a request, or a clock.
 */

const MIN_PASSWORD_LENGTH = 12

/**
 * Reject passwords that a wordlist breaks instantly.
 *
 * Length alone is not enough: "password1234" is twelve characters and sits in
 * every cracking dictionary ever assembled. Returns a reason, or null.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  }

  if (/^(.)\1+$/.test(password)) {
    return 'Password cannot be one repeated character'
  }

  // Compared on letters alone, so "P@ssw0rd!!" and "password" collapse to the
  // same entry — which is how a cracker treats them too.
  const letters = password.toLowerCase().replace(/[^a-z]/g, '')
  for (const common of COMMON_PASSWORDS) {
    if (letters === common || letters.startsWith(common)) {
      return 'That password is too common. Choose something less guessable.'
    }
  }

  return null
}

/**
 * Constant-time comparison, for anywhere a secret is compared.
 *
 * `===` on strings short-circuits at the first differing byte, which leaks the
 * length of a correct prefix to anyone able to time the response.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
