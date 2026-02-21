/**
 * POST /api/access/request
 *
 * Send a 6-digit SMS OTP to a phone number.
 * Rate-limited to 1 request per phone per 10-minute window.
 */

import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { generateOTP, normalizePhone, maskPhone } from '@/lib/access-gate'
import { logAccess } from '@/lib/access-log'
import { getEntryByPhone } from '@/lib/access-allowlist'

const ACCESS_SECRET = process.env.GWI_ACCESS_SECRET ?? ''

/** Mask email for display: br***@gmail.com */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  const visible = local.slice(0, Math.min(2, local.length))
  return `${visible}***@${domain}`
}

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT ?? '587'),
    secure: false, // STARTTLS
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })
}

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

  // Check allowlist and get entry (includes email)
  const entry = await getEntryByPhone(normalized)
  if (!entry) {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const ua = req.headers.get('user-agent') ?? ''
    await logAccess(maskPhone(normalized), ip, ua, 'blocked')
    return NextResponse.json(
      { error: "This number isn't registered for demo access. Contact GWI to request access." },
      { status: 403 }
    )
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

  // Send code via email (SMTP / Nodemailer)
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.error('[access/request] SMTP credentials not configured')
    return NextResponse.json({ error: 'Email service not configured' }, { status: 503 })
  }

  const fromEmail = process.env.SMTP_FROM ?? process.env.SMTP_USER

  try {
    const transporter = createTransporter()
    await transporter.sendMail({
      from: `GWI POS Access <${fromEmail}>`,
      to: entry.email,
      subject: `Your GWI demo access code: ${code}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
          <h2 style="margin:0 0 8px;font-size:20px;color:#111">GWI Point of Sale</h2>
          <p style="margin:0 0 24px;color:#555;font-size:14px">Your access code for barpos.restaurant</p>
          <div style="background:#f4f4f5;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
            <p style="margin:0 0 4px;font-size:13px;color:#888;letter-spacing:0.05em;text-transform:uppercase">Access Code</p>
            <p style="margin:0;font-size:40px;font-weight:700;letter-spacing:0.15em;color:#111">${code}</p>
          </div>
          <p style="margin:0 0 8px;color:#555;font-size:13px">Enter this code on the access page. It expires in <strong>10 minutes</strong>.</p>
          <p style="margin:0 0 8px;color:#555;font-size:13px">Your session will stay active as long as you&apos;re using the demo. After <strong>1 hour of inactivity</strong> you&apos;ll need to request a new code.</p>
          <p style="margin:0;color:#999;font-size:12px">If you didn't request this, you can ignore this email.</p>
        </div>
      `,
      text: `Your GWI POS demo access code is: ${code}\n\nExpires in 10 minutes. Session stays active while you use the demo — you'll be asked to re-verify after 1 hour of inactivity.`,
    })
  } catch (err) {
    console.error('[access/request] Email send failed:', err)
    return NextResponse.json({ error: 'Failed to send email' }, { status: 502 })
  }

  // Log the attempt
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const ua = req.headers.get('user-agent') ?? ''
  await logAccess(maskPhone(normalized), ip, ua, 'code_sent')

  // Set rate-limit cookie (1-minute window)
  const res = NextResponse.json({ success: true, email: maskEmail(entry.email) })
  res.cookies.set('gwi-access-rate', String(Date.now()), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 120,
    path: '/',
  })
  return res
}
