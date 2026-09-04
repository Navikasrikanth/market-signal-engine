import { cookies, headers } from 'next/headers'
import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { db } from './db'
import { passwordProblem } from './password'

export { passwordProblem, safeEqual } from './password'

/**
 * Email + password, an opaque session token, an httpOnly cookie. No OAuth, no
 * reset flow, no verification.
 *
 * It exists because the assignment requires state to persist across sessions
 * and devices, which needs an identity — not because the project is about auth.
 * Thin, but the parts that are here are meant to survive being looked at:
 *
 *   - the token is never stored, only its SHA-256
 *   - failed attempts are rate-limited and then locked out
 *   - sessions expire absolutely AND on idle
 *   - passwords are bcrypt cost 12, with a length and dictionary floor
 *   - every query in the app is scoped by the session's user id
 */

const COOKIE = 'sitrep_session'

/** A session dies at this age however active it is. */
const ABSOLUTE_DAYS = 30

/**
 * ...and dies this long after its last use. The absolute cap alone leaves an
 * abandoned session on a shared machine valid for a month.
 */
const IDLE_DAYS = 7

/**
 * bcrypt cost. 10 was the old value and is cheap on 2026 hardware; 12 is ~4x
 * the work for an attacker and still single-digit milliseconds for us.
 */
const BCRYPT_COST = 12

/** Backoff starts here, lockout lands here, counted over the window below. */
const BACKOFF_AFTER = 5
const LOCKOUT_AFTER = 10
const ATTEMPT_WINDOW_MINUTES = 15

export interface SessionUser {
  id: string
  email: string
  displayName: string
}

export class UnauthorizedError extends Error {
  readonly status = 401
  constructor() {
    super('Not signed in')
    this.name = 'UnauthorizedError'
  }
}

export class RateLimitedError extends Error {
  readonly status = 429
  constructor(message: string) {
    super(message)
    this.name = 'RateLimitedError'
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST)
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

// ---------------------------------------------------------------- sessions

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Best-effort client identity, for the audit trail and the rate limiter. */
async function requestIdentity(): Promise<{ ip: string; userAgent: string }> {
  try {
    const h = await headers()
    const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim()
    return {
      ip: forwarded || h.get('x-real-ip') || 'unknown',
      userAgent: (h.get('user-agent') ?? 'unknown').slice(0, 300),
    }
  } catch {
    // Called outside a request — a script, or a test. Not fatal.
    return { ip: 'unknown', userAgent: 'unknown' }
  }
}

export async function createSession(userId: string): Promise<string> {
  // 256 bits from the CSPRNG. The old id was a v4 uuid — 122 bits, and worse,
  // it was the stored value as well as the presented one.
  const token = randomBytes(32).toString('base64url')

  const expiresAt = new Date()
  expiresAt.setUTCDate(expiresAt.getUTCDate() + ABSOLUTE_DAYS)

  const { ip, userAgent } = await requestIdentity()

  await db.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt, ip, userAgent },
  })

  const jar = await cookies()
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  })

  return token
}

export async function destroySession(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(COOKIE)?.value
  if (token) {
    await db.session.deleteMany({ where: { tokenHash: hashToken(token) } })
  }
  jar.delete(COOKIE)
}

/** Revoke every session for a user — the "sign out everywhere" primitive. */
export async function destroyAllSessions(userId: string): Promise<number> {
  const { count } = await db.session.deleteMany({ where: { userId } })
  return count
}

/**
 * The signed-in user, or null.
 *
 * Expired sessions — by either clock — are deleted rather than merely ignored,
 * so a stale row cannot come back to life if a system clock moves backwards.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies()
  const token = jar.get(COOKIE)?.value
  if (!token) return null

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: { select: { id: true, email: true, displayName: true } },
    },
  })

  if (!session) return null

  const now = new Date()
  const idleDeadline = new Date(session.lastUsedAt)
  idleDeadline.setUTCDate(idleDeadline.getUTCDate() + IDLE_DAYS)

  if (session.expiresAt < now || idleDeadline < now) {
    await db.session.deleteMany({ where: { id: session.id } })
    return null
  }

  // Slide the idle window, but never past the absolute cap. Written at most
  // once an hour: a write on every page load would turn reading the brief into
  // a write operation.
  if (now.getTime() - session.lastUsedAt.getTime() > 3_600_000) {
    await db.session.update({
      where: { id: session.id },
      data: { lastUsedAt: now },
    })
  }

  return session.user
}

/**
 * The user, or a thrown 401.
 *
 * Route handlers call this rather than checking for null themselves, so there
 * is no path where a missing session silently falls through to an unscoped
 * query.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser()
  if (!user) throw new UnauthorizedError()
  return user
}

/** Delete sessions past either deadline. Run by the worker's sweep job. */
export async function sweepExpiredSessions(): Promise<number> {
  const now = new Date()
  const idleCutoff = new Date(now)
  idleCutoff.setUTCDate(idleCutoff.getUTCDate() - IDLE_DAYS)

  const { count } = await db.session.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: now } }, { lastUsedAt: { lt: idleCutoff } }],
    },
  })
  return count
}

// ---------------------------------------------------------------- rate limit

/**
 * How long this identity must wait, in seconds. Zero means proceed.
 *
 * Counted over both email and IP: limiting only by email lets one attacker
 * spray many accounts, and limiting only by IP lets a botnet through.
 */
async function throttleFor(email: string, ip: string): Promise<number> {
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MINUTES * 60_000)

  const [byEmail, byIp] = await Promise.all([
    db.loginAttempt.count({
      where: { email, succeeded: false, attemptAt: { gt: since } },
    }),
    db.loginAttempt.count({
      where: { ip, succeeded: false, attemptAt: { gt: since } },
    }),
  ])

  const failures = Math.max(byEmail, byIp)
  if (failures >= LOCKOUT_AFTER) return ATTEMPT_WINDOW_MINUTES * 60
  if (failures >= BACKOFF_AFTER) return 2 ** (failures - BACKOFF_AFTER + 1)
  return 0
}

async function recordAttempt(
  email: string,
  ip: string,
  succeeded: boolean,
): Promise<void> {
  await db.loginAttempt.create({ data: { email, ip, succeeded } })

  if (!succeeded) return

  // A correct password clears this account's failures.
  //
  // Without it the counter is punitive rather than protective: six typos
  // followed by a successful sign-in still leaves six failures in the window,
  // so one more typo an hour later locks out a user who has already proved
  // who they are.
  //
  // The IP counter is deliberately NOT cleared. On shared egress - office
  // NAT, mobile carrier - an attacker holding one valid account could
  // otherwise reset their own throttle at will by signing into it.
  await db.loginAttempt.deleteMany({ where: { email, succeeded: false } })
}

// ---------------------------------------------------------------- accounts

export async function register(
  email: string,
  password: string,
  displayName: string,
): Promise<SessionUser> {
  const normalised = email.trim().toLowerCase()
  const { ip } = await requestIdentity()

  // Registration is rate-limited too. Without it the "already exists" reply
  // makes this endpoint an unlimited account-enumeration oracle.
  const wait = await throttleFor(normalised, ip)
  if (wait > 0) {
    throw new RateLimitedError(`Too many attempts. Try again in ${wait}s.`)
  }

  const problem = passwordProblem(password)
  if (problem) throw new Error(problem)

  const existing = await db.user.findUnique({ where: { email: normalised } })
  if (existing) {
    await recordAttempt(normalised, ip, false)
    throw new Error('An account with that email already exists')
  }

  const user = await db.user.create({
    data: {
      email: normalised,
      passwordHash: await hashPassword(password),
      displayName: displayName.trim() || normalised.split('@')[0],
      settings: { attentionBudget: 5, timezone: 'America/New_York' },
    },
  })

  await db.watchlist.create({
    data: { userId: user.id, name: 'My Watchlist' },
  })

  await recordAttempt(normalised, ip, true)
  await createSession(user.id)
  return { id: user.id, email: user.email, displayName: user.displayName }
}

/** A real bcrypt hash, so the no-such-user path costs the same as the real one. */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.9Zt0Cx3n7oqA6Q3vJ0kK5oQeQ5m1bLu'

export async function login(
  email: string,
  password: string,
): Promise<SessionUser> {
  const normalised = email.trim().toLowerCase()
  const { ip } = await requestIdentity()

  const wait = await throttleFor(normalised, ip)
  if (wait > 0) {
    throw new RateLimitedError(`Too many attempts. Try again in ${wait}s.`)
  }

  const user = await db.user.findUnique({ where: { email: normalised } })

  // Same message and comparable work either way, so the response cannot be used
  // to enumerate which addresses have accounts.
  const ok = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, DUMMY_HASH)

  if (!user || !ok) {
    await recordAttempt(normalised, ip, false)
    throw new Error('Incorrect email or password')
  }

  await recordAttempt(normalised, ip, true)
  await createSession(user.id)
  return { id: user.id, email: user.email, displayName: user.displayName }
}

/**
 * The sign-in before this one, for the brief's opening line.
 *
 * Deliberately the previous session, not the current one: "you last checked on
 * Tuesday" means the visit before this one.
 */
export async function previousSignIn(
  userId: string,
): Promise<{ at: Date; ip: string | null; userAgent: string | null } | null> {
  const sessions = await db.session.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 2,
    select: { createdAt: true, ip: true, userAgent: true },
  })

  const prior = sessions[1]
  if (!prior) return null
  return { at: prior.createdAt, ip: prior.ip, userAgent: prior.userAgent }
}
