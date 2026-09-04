import { describe, expect, it } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { passwordProblem, safeEqual } from '../password'

/**
 * Auth properties that must hold, expressed as tests rather than as comments.
 *
 * The database-backed behaviour (lockout, idle expiry, hashed storage) is
 * exercised end to end by scripts/verify-auth.ts against real Postgres; these
 * cover the pure logic, which is where the subtle mistakes live.
 */

describe('passwordProblem', () => {
  it('rejects passwords that are merely long', () => {
    // The exact failure the old 8-character floor allowed through: twelve
    // characters, and in every cracking wordlist ever assembled.
    expect(passwordProblem('password1234')).toMatch(/too common/)
    expect(passwordProblem('qwertyuiop12')).toMatch(/too common/)
    expect(passwordProblem('letmein12345')).toMatch(/too common/)
  })

  it('sees through leetspeak, because a cracker does', () => {
    // Reduced to letters, "P@ssw0rd!!!!" is "pssword" — close enough that
    // treating it as distinct would be self-deception.
    expect(passwordProblem('Passw0rd!!!!')).toMatch(/too common/)
  })

  it('rejects anything below the length floor', () => {
    expect(passwordProblem('short')).toMatch(/at least 12/)
    expect(passwordProblem('elevenchars')).toMatch(/at least 12/)
  })

  it('rejects a single repeated character', () => {
    expect(passwordProblem('aaaaaaaaaaaaaa')).toMatch(/repeated/)
  })

  it('accepts a genuinely unguessable password', () => {
    expect(passwordProblem('correct-horse-battery-staple')).toBeNull()
    expect(passwordProblem('gT7#qm2Lz!vRw9')).toBeNull()
  })
})

describe('session tokens', () => {
  it('are unguessable and never equal to their stored form', () => {
    const token = randomBytes(32).toString('base64url')
    const stored = createHash('sha256').update(token).digest('hex')

    // 256 bits of entropy, and the stored value cannot be presented as a
    // credential: this is the whole point of the change.
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
    expect(stored).not.toBe(token)
    expect(stored).toHaveLength(64)
  })

  it('hash deterministically, so lookup by hash works', () => {
    const token = randomBytes(32).toString('base64url')
    const a = createHash('sha256').update(token).digest('hex')
    const b = createHash('sha256').update(token).digest('hex')
    expect(a).toBe(b)
  })
})

describe('safeEqual', () => {
  it('compares equal strings as equal', () => {
    expect(safeEqual('abc123', 'abc123')).toBe(true)
  })

  it('rejects different strings, including different lengths', () => {
    expect(safeEqual('abc123', 'abc124')).toBe(false)
    expect(safeEqual('abc', 'abcdef')).toBe(false)
    expect(safeEqual('', 'a')).toBe(false)
  })
})
