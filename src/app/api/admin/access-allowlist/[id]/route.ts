/**
 * DELETE /api/admin/access-allowlist/[id]  — remove an entry
 * PATCH  /api/admin/access-allowlist/[id]  — regenerate access code
 *
 * Protected: requires Authorization: Bearer <INTERNAL_API_SECRET>
 */

import { NextRequest, NextResponse } from 'next/server'
import { removeFromAllowlist, regenerateAccessCode } from '@/lib/access-allowlist'

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
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  await removeFromAllowlist(id)
  return NextResponse.json({ success: true })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const newCode = await regenerateAccessCode(id)
  return NextResponse.json({ access_code: newCode })
}
