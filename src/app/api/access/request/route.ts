/**
 * POST /api/access/request
 *
 * Verify that a phone number is registered on the GWI access allowlist.
 * Returns { success: true } so the client can advance to the code-entry step.
 *
 * No OTP is sent — users enter their personal access code issued by GWI.
 * Zero external dependencies (no SMS, no email service).
 */

import { NextRequest, NextResponse } from 'next/server'
import { normalizePhone, maskPhone } from '@/lib/access-gate'
import { logAccess } from '@/lib/access-log'
import { getEntryByPhone } from '@/lib/access-allowlist'

const ACCESS_SECRET = process.env.GWI_ACCESS_SECRET ?? ''

export async function POST(req: NextRequest) {
  if (!ACCESS_SECRET) {
    console.error('[access/request] GWI_ACCESS_SECRET not set')
    return NextResponse.json({ error: 'Access gate not configured' }, { status: 503 })
  }

  let phone: string
  try {
    const body = await req.json()
    phone = String(body.phone ?? '').trim()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const normalized = normalizePhone(phone)
  if (!/^\+1\d{10}$/.test(normalized)) {
    return NextResponse.json({ error: 'Enter a valid US phone number' }, { status: 400 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const ua = req.headers.get('user-agent') ?? ''

  // Check allowlist
  const entry = await getEntryByPhone(normalized)
  if (!entry) {
    await logAccess(maskPhone(normalized), ip, ua, 'blocked')
    return NextResponse.json(
      { error: "This number isn't registered for demo access. Contact GWI to request access." },
      { status: 403 }
    )
  }

  await logAccess(maskPhone(normalized), ip, ua, 'code_sent')

  return NextResponse.json({ success: true })
}
