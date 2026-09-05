import { requireUser, destroyAllSessions, destroySession } from '@/lib/auth'
import { handler, ok } from '@/lib/api'

/**
 * Sign out everywhere.
 *
 * The one control that matters after a password is exposed: without it a
 * stolen cookie stays valid for its full 30 days and the owner can do nothing
 * about it. Revokes every session for the user, including this one.
 */
export const POST = handler(async () => {
  const user = await requireUser()
  const count = await destroyAllSessions(user.id)
  await destroySession()
  return ok({ revoked: count })
})
