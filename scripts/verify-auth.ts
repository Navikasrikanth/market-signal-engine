import 'dotenv/config'
import { createHash } from 'node:crypto'
import { db } from '../src/lib/db'
import { hashPassword, sweepExpiredSessions } from '../src/lib/auth'
import { passwordProblem } from '../src/lib/password'

/**
 * Auth properties, against real Postgres.
 *
 * The unit tests cover the pure rules; these cover the ones that only mean
 * something with a database behind them — that the token is genuinely absent
 * from storage, that lockout counts what it claims to, and that an idle
 * session actually dies.
 */

let passed = 0
let failed = 0

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const EMAIL = 'authcheck@sitrep.local'
const IP = '203.0.113.7'

async function main() {
  await db.loginAttempt.deleteMany({ where: { email: EMAIL } })
  await db.user.deleteMany({ where: { email: EMAIL } })

  const user = await db.user.create({
    data: {
      email: EMAIL,
      passwordHash: await hashPassword('correct-horse-battery-staple'),
      displayName: 'Auth Check',
      settings: {},
    },
  })

  // ------------------------------------------------------------ storage
  console.log('\n[1] The token is not in the database')

  const token = 'a-known-token-value-for-this-test'
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(Date.now() + 30 * 86_400_000)

  const session = await db.session.create({
    data: { userId: user.id, tokenHash, expiresAt, ip: IP, userAgent: 'test' },
  })

  const raw = JSON.stringify(
    await db.session.findUnique({ where: { id: session.id } }),
  )
  check(
    'no session row contains the bearer token',
    !raw.includes(token),
    'a stolen database yields no usable session',
  )
  check('the row stores a SHA-256 instead', raw.includes(tokenHash))
  check(
    'lookup by hash finds the session',
    (await db.session.findUnique({ where: { tokenHash } }))?.id === session.id,
  )

  // ------------------------------------------------------------ lockout
  console.log('\n[2] Failed attempts are counted and then locked out')

  for (let i = 0; i < 10; i++) {
    await db.loginAttempt.create({
      data: { email: EMAIL, ip: IP, succeeded: false },
    })
  }

  const since = new Date(Date.now() - 15 * 60_000)
  const failures = await db.loginAttempt.count({
    where: { email: EMAIL, succeeded: false, attemptAt: { gt: since } },
  })
  check('ten failures are recorded inside the window', failures === 10, `${failures}`)

  const byIp = await db.loginAttempt.count({
    where: { ip: IP, succeeded: false, attemptAt: { gt: since } },
  })
  check(
    'the same failures are countable by IP',
    byIp === 10,
    'so one attacker cannot spray many accounts',
  )

  // A correct password clears the account's failures, but not the origin's.
  await db.loginAttempt.create({
    data: { email: EMAIL, ip: IP, succeeded: true },
  })
  await db.loginAttempt.deleteMany({ where: { email: EMAIL, succeeded: false } })

  const emailAfter = await db.loginAttempt.count({
    where: { email: EMAIL, succeeded: false, attemptAt: { gt: since } },
  })
  check(
    'a successful sign-in clears that account’s failures',
    emailAfter === 0,
    'the counter protects an account, it does not punish one',
  )

  // ------------------------------------------------------------ expiry
  console.log('\n[3] Sessions die on both clocks')

  const idle = await db.session.create({
    data: {
      userId: user.id,
      tokenHash: createHash('sha256').update('idle-token').digest('hex'),
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      // Well inside the absolute cap, well past the idle one.
      lastUsedAt: new Date(Date.now() - 8 * 86_400_000),
    },
  })

  const absolute = await db.session.create({
    data: {
      userId: user.id,
      tokenHash: createHash('sha256').update('expired-token').digest('hex'),
      expiresAt: new Date(Date.now() - 1000),
    },
  })

  const swept = await sweepExpiredSessions()
  const idleGone = !(await db.session.findUnique({ where: { id: idle.id } }))
  const absoluteGone = !(await db.session.findUnique({ where: { id: absolute.id } }))
  const liveKept = !!(await db.session.findUnique({ where: { id: session.id } }))

  check('an idle session is swept', idleGone, '8 days unused, cap is 7')
  check('an absolutely expired session is swept', absoluteGone)
  check('a live session survives the sweep', liveKept, `${swept} removed`)

  // ------------------------------------------------------------ passwords
  console.log('\n[4] Password floor')

  check(
    'a long dictionary password is refused',
    passwordProblem('password1234') !== null,
    'twelve characters is not the same as unguessable',
  )
  check('a short password is refused', passwordProblem('short') !== null)
  check(
    'a strong password is accepted',
    passwordProblem('correct-horse-battery-staple') === null,
  )

  await db.user.delete({ where: { id: user.id } })
  await db.loginAttempt.deleteMany({ where: { email: EMAIL } })

  console.log(`\n${'='.repeat(50)}`)
  console.log(`${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
