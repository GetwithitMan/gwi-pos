/**
 * POST /api/access/request
 *
 * Send a 6-digit SMS OTP to a phone number.
 * Rate-limited to 1 request per phone per 10-minute window.
 */

import { NextRequest, NextResponse } from 'next/server'
import { generateOTP, normalizePhone, maskPhone } from '@/lib/access-gate'
import { logAccess } from '@/lib/access-log'

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

  // Rate-limit: check last-request cookie (set after code is sent)
  const lastRequest = req.cookies.get('gwi-access-rate')?.value
  if (lastRequest) {
    const elapsed = Date.now() - Number(lastRequest)
    if (elapsed < 60_000) {
      const waitSec = Math.ceil((60_000 - elapsed) / 1000)
      return NextResponse.json(
        { error: `Please wait ${waitSec}s before requesting another code` },
        { status: 429 }
      )
    }
  }

  // Generate OTP
  const code = await generateOTP(normalized, ACCESS_SECRET)

  // Send SMS via Twilio
  const twilioSid = process.env.TWILIO_ACCOUNT_SID
  const twilioToken = process.env.TWILIO_AUTH_TOKEN
  const twilioFrom = process.env.TWILIO_FROM_NUMBER

  if (!twilioSid || !twilioToken || !twilioFrom) {
    console.error('[access/request] Twilio credentials not configured')
    return NextResponse.json({ error: 'SMS service not configured' }, { status: 503 })
  }

  try {
    const body = new URLSearchParams({
      To: normalized,
      From: twilioFrom,
      Body: `GWI POS access code: ${code}\n\nExpires in 10 minutes. Do not share this code.`,
    })

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      }
    )

    if (!response.ok) {
      const err = await response.text()
      console.error('[access/request] Twilio error:', err)
      return NextResponse.json({ error: 'Failed to send SMS' }, { status: 502 })
    }
  } catch (err) {
    console.error('[access/request] SMS send failed:', err)
    return NextResponse.json({ error: 'Failed to send SMS' }, { status: 502 })
  }

  // Log the attempt
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const ua = req.headers.get('user-agent') ?? ''
  await logAccess(maskPhone(normalized), ip, ua, 'code_sent')

  // Set rate-limit cookie (1-minute window)
  const res = NextResponse.json({ success: true })
  res.cookies.set('gwi-access-rate', String(Date.now()), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 120,
    path: '/',
  })
  return res
}
