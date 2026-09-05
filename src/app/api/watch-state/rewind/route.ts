import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { invalidateUser } from '@/lib/cache'
import { handler, ok, parseBody } from '@/lib/api'

/**
 * Move your own cursor back, deliberately.
 *
 * "Since you last looked" is normally set by the product — it moves when you
 * acknowledge something and never when you merely read. This is the one place
 * a user gets to set it themselves, and it exists for two honest reasons:
 *
 *   - you were away longer than the product knows, because you were reading
 *     over someone's shoulder or on a device that was never signed in
 *   - you want the longer view: what has this watchlist done over a quarter,
 *     rather than since Tuesday
 *
 * It also happens to make the product demonstrable on any dataset, which is
 * why it is a control rather than a seed script.
 *
 * Only ever moves the cursor BACKWARDS. Pushing it forward would silently mark
 * things as seen that were never shown, which is the one thing the cursor must
 * never do.
 */
const schema = z.object({
  days: z.number().int().min(1).max(3650),
})

export const POST = handler(async (req) => {
  const user = await requireUser()
  const { days } = await parseBody(req, schema)

  const target = new Date(Date.now() - days * 86_400_000)

  const watchlist = await db.watchlist.findFirst({
    where: { userId: user.id },
    select: { items: { select: { instrumentId: true } } },
  })
  const owned = (watchlist?.items ?? []).map((i) => i.instrumentId)

  let moved = 0
  for (const instrumentId of owned) {
    const snapshot = await db.dailyBar.findFirst({
      where: { instrumentId, barDate: { lte: target } },
      orderBy: { barDate: 'desc' },
      select: { barDate: true, closeAdj: true },
    })

    await db.userWatchState.upsert({
      where: { userId_instrumentId: { userId: user.id, instrumentId } },
      create: {
        userId: user.id,
        instrumentId,
        lastSeenAt: target,
        lastSeenSnap: {
          date: snapshot?.barDate.toISOString().slice(0, 10) ?? null,
          close: snapshot ? Number(snapshot.closeAdj) : null,
          rank: null,
        },
      },
      // Backwards only. A cursor that can jump forward would mark unseen
      // events as seen, which is the one thing it must never do.
      update: {
        lastSeenAt: target,
        lastSeenSnap: {
          date: snapshot?.barDate.toISOString().slice(0, 10) ?? null,
          close: snapshot ? Number(snapshot.closeAdj) : null,
          rank: null,
        },
      },
    })
    moved++
  }

  // Everything the user has already dismissed is dismissed against a window
  // that no longer exists. Clearing it is what makes the rewind mean anything.
  await db.userEventState.deleteMany({ where: { userId: user.id } })
  await invalidateUser(user.id)

  return ok({ moved, since: target.toISOString() })
})
