import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { invalidateUser } from '@/lib/cache'
import { handler, ok, parseBody } from '@/lib/api'

/**
 * The one setting that changes what the product does.
 *
 * The attention budget is the number of cards the brief will show, and it was
 * read from user settings from the start while being settable only by editing
 * the database. A filter whose severity the user cannot adjust is a filter
 * they have to either accept or abandon.
 *
 * Bounded 3..10 deliberately. Below three the brief stops being a brief; above
 * ten it stops filtering, which is the entire product.
 */
const schema = z.object({
  attentionBudget: z.number().int().min(3).max(10),
})

export const PATCH = handler(async (req) => {
  const user = await requireUser()
  const { attentionBudget } = await parseBody(req, schema)

  const existing = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { settings: true },
  })

  await db.user.update({
    where: { id: user.id },
    data: {
      settings: {
        ...((existing.settings ?? {}) as Record<string, unknown>),
        attentionBudget,
      },
    },
  })

  // Changes how many cards are shown, so the cached brief is now an answer to
  // a different question.
  await invalidateUser(user.id)

  return ok({ attentionBudget })
})
