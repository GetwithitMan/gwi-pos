/**
 * POST /api/access/verify
 *
 * Verify a personal access code for a registered phone number.
 * On success, sets the gwi-access httpOnly cookie (1-hour JWT, refreshed on each request)
 * and logs the access event.
 */

import { NextRequest, NextResponse } from 'next/server'
import { signAccessToken, normalizePhone, maskPhone } from '@/lib/access-gate'
import { logAccess } from '@/lib/access-log'
import { verifyAccessCode } from '@/lib/access-allowlist'

const ACCESS_SECRET = process.env.GWI_ACCESS_SECRET ?? ''

export async function POST(req: NextRequest) {
  if (!ACCESS_SECRET) {
    return NextResponse.json({ error: 'Access gate not configured' }, { status: 503 })
  }

  let phone: string, code: string
  try {
    const body = await req.json()
    phone = String(body.phone ?? '').trim()
    code = String(body.code ?? '').trim()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const normalized = normalizePhone(phone)
  if (!/^\+1\d{10}$/.test(normalized)) {
    return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
  }

  if (!code) {
    return NextResponse.json({ error: 'Access code is required' }, { status: 400 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const ua = req.headers.get('user-agent') ?? ''

  const valid = await verifyAccessCode(normalized, code)

  if (!valid) {
    await logAccess(maskPhone(normalized), ip, ua, 'denied')
    return NextResponse.json({ error: 'Invalid access code' }, { status: 401 })
  }

  const token = await signAccessToken(normalized, ACCESS_SECRET)
  await logAccess(maskPhone(normalized), ip, ua, 'verified')

  const res = NextResponse.json({ success: true })
  res.cookies.set('gwi-access', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60,
    path: '/',
  })
  res.cookies.delete('gwi-access-rate')
  return res
}
