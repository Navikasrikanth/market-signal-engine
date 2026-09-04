import { z } from 'zod'
import { register } from '@/lib/auth'
import { handler, ok, parseBody } from '@/lib/api'

const schema = z.object({
  email: z.string().email(),
  // Length is checked again in `passwordProblem`, alongside the dictionary
  // floor. Kept here so an obviously-short password fails before any hashing.
  password: z.string().min(12, 'Password must be at least 12 characters'),
  displayName: z.string().max(60).optional().default(''),
})

export const POST = handler(async (req) => {
  const { email, password, displayName } = await parseBody(req, schema)
  const user = await register(email, password, displayName)
  return ok({ user }, { status: 201 })
})
