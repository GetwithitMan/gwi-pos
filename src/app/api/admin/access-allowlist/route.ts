/**
 * GET  /api/admin/access-allowlist  — list all allowlist entries
 * POST /api/admin/access-allowlist  — add a new entry
 *
 * Protected: requires Authorization: Bearer <INTERNAL_API_SECRET>
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAllowlist, addToAllowlist } from '@/lib/access-allowlist'
import { normalizePhone } from '@/lib/access-gate'

function authorize(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET
  const authHeader = req.headers.get('authorization')
  return Boolean(secret && authHeader === `Bearer ${secret}`)
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const entries = await getAllowlist()
  return NextResponse.json({ entries })
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { name, email, phone, notes, addedBy } = body as {
    name?: string
    email?: string
    phone?: string
    notes?: string
    addedBy?: string
  }

  if (!name || !email || !phone || !addedBy) {
    return NextResponse.json(
      { error: 'Missing required fields: name, email, phone, addedBy' },
      { status: 400 }
    )
  }

  const normalized = normalizePhone(phone)
  if (!/^\+1\d{10}$/.test(normalized)) {
    return NextResponse.json(
      { error: 'Phone must be a valid US number' },
      { status: 400 }
    )
  }

  const entry = await addToAllowlist(name, email, normalized, notes ?? null, addedBy)
  return NextResponse.json({ entry }, { status: 201 })
}
