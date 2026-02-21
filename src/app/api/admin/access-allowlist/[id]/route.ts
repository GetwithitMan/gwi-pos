/**
 * DELETE /api/admin/access-allowlist/[id]  — remove an entry
 *
 * Protected: requires Authorization: Bearer <INTERNAL_API_SECRET>
 */

import { NextRequest, NextResponse } from 'next/server'
import { removeFromAllowlist } from '@/lib/access-allowlist'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const secret = process.env.INTERNAL_API_SECRET
  const authHeader = req.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  await removeFromAllowlist(id)
  return NextResponse.json({ success: true })
}
