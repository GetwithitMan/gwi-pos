/**
 * GET  /api/admin/access-allowlist  — list all allowlist entries
 * POST /api/admin/access-allowlist  — add a new entry
 *
 * Protected: requires Authorization: Bearer <INTERNAL_API_SECRET>
 */

import { NextRequest } from 'next/server'
import { getAllowlist, addToAllowlist } from '@/lib/access-allowlist'
import { created, err, ok, unauthorized } from '@/lib/api-response'

/** Normalize phone to E.164 digits only */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`
  return `+${digits}`
}

function authorize(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET
  const authHeader = req.headers.get('authorization')
  return Boolean(secret && authHeader === `Bearer ${secret}`)
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return unauthorized('Unauthorized')
  }

  const entries = await getAllowlist()
  return ok({ entries })
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return unauthorized('Unauthorized')
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return err('Invalid request body')
  }

  const { name, email, phone, notes, addedBy } = body as {
    name?: string
    email?: string
    phone?: string
    notes?: string
    addedBy?: string
  }

  if (!name || !email || !phone || !addedBy) {
    return err('Missing required fields: name, email, phone, addedBy')
  }

  const normalized = normalizePhone(phone)
  if (!/^\+1\d{10}$/.test(normalized)) {
    return err('Phone must be a valid US number')
  }

  const entry = await addToAllowlist(name, email, normalized, notes ?? null, addedBy)
  return created({ entry })
}
