/**
 * DELETE /api/admin/access-allowlist/[id]  — remove an entry
 * PATCH  /api/admin/access-allowlist/[id]  — regenerate access code
 *
 * Protected: requires Authorization: Bearer <INTERNAL_API_SECRET>
 */

import { NextRequest } from 'next/server'
import { removeFromAllowlist, regenerateAccessCode } from '@/lib/access-allowlist'
import { ok, unauthorized } from '@/lib/api-response'

function authorize(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET
  const authHeader = req.headers.get('authorization')
  return Boolean(secret && authHeader === `Bearer ${secret}`)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authorize(req)) {
    return unauthorized('Unauthorized')
  }
  const { id } = await params
  await removeFromAllowlist(id)
  return ok({ success: true })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authorize(req)) {
    return unauthorized('Unauthorized')
  }
  const { id } = await params
  const newCode = await regenerateAccessCode(id)
  return ok({ access_code: newCode })
}
