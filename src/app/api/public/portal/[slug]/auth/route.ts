/**
 * POST /api/public/portal/[slug]/auth — Customer portal OTP authentication
 *
 * Two actions:
 *   action='request-otp'  — Rate-limited 3/phone/10min. Sends OTP via SMS.
 *   action='verify-otp'   — Verifies OTP, creates session, sets httpOnly cookie.
 *
 * No authentication required (public). Resolves venue by slug.
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getDbForVenue } from '@/lib/db'
import { createRateLimiter } from '@/lib/rate-limiter'
import { normalizePhone } from '@/lib/utils'
import {
  generateOTP,
  verifyOTP,
  generateSessionToken,
  getSessionExpiry,
} from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

// 3 OTP requests per phone per 10 minutes
const otpLimiter = createRateLimiter({ maxAttempts: 3, windowMs: 10 * 60 * 1000 })

export async function POST(
  request: NextRequest,
  context: any,
) {
  try {
    const { slug } = (await context.params) as { slug: string }

    if (!slug) {
      return NextResponse.json({ error: 'Venue slug is required' }, { status: 400 })
    }

    // ── Resolve venue DB ───────────────────────────────────────────────
    let venueDb
    try {
      venueDb = getDbForVenue(slug)
    } catch {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    // ── Get location ─────────────────────────────────────────────────
    const location = await venueDb.location.findFirst({
      where: { isActive: true },
      select: { id: true, name: true },
    })

    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    const locationId = location.id

    // ── Parse body ───────────────────────────────────────────────────
    const body = await request.json()
    const { action } = body

    // ═════════════════════════════════════════════════════════════════
    // ACTION: request-otp
    // ═════════════════════════════════════════════════════════════════
    if (action === 'request-otp') {
      const { phone } = body
      if (!phone || typeof phone !== 'string') {
        return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
      }

      const normalizedPhone = normalizePhone(phone)
      if (!normalizedPhone) {
        return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
      }

      // ── Rate limit by phone ──────────────────────────────────────
      const rl = otpLimiter.check(`portal-otp:${normalizedPhone}`)
      if (!rl.allowed) {
        return NextResponse.json(
          { error: 'Too many verification attempts. Please wait before trying again.' },
          { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
        )
      }

      // ── Find customer by phone + locationId ──────────────────────
      const customers = await venueDb.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id" FROM "Customer"
         WHERE "locationId" = $1 AND "phone" = $2 AND "deletedAt" IS NULL
         LIMIT 1`,
        locationId,
        normalizedPhone,
      )

      if (customers.length === 0) {
        return NextResponse.json(
          { error: 'No account found for this phone number' },
          { status: 404 },
        )
      }

      const customerId = customers[0].id

      // ── Generate OTP ─────────────────────────────────────────────
      const { code, hash, expiresAt } = generateOTP()

      // ── Insert CustomerPortalSession ─────────────────────────────
      const sessionId = crypto.randomUUID()
      await venueDb.$executeRawUnsafe(
        `INSERT INTO "CustomerPortalSession" (
          "id", "locationId", "customerId", "phone",
          "otpHash", "otpExpiresAt", "createdAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        sessionId,
        locationId,
        customerId,
        normalizedPhone,
        hash,
        expiresAt,
      )

      // ── Send SMS (fire-and-forget) ───────────────────────────────
      void (async () => {
        try {
          const { sendSMS } = await import('@/lib/twilio')
          await sendSMS({
            to: normalizedPhone,
            body: `Your verification code is: ${code}. Valid for 10 minutes.`,
          })
        } catch (err) {
          console.error('[portal-auth] OTP SMS failed:', err)
        }
      })()

      return NextResponse.json({ success: true })
    }

    // ═════════════════════════════════════════════════════════════════
    // ACTION: verify-otp
    // ═════════════════════════════════════════════════════════════════
    if (action === 'verify-otp') {
      const { phone, code } = body
      if (!phone || typeof phone !== 'string') {
        return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
      }
      if (!code || typeof code !== 'string') {
        return NextResponse.json({ error: 'Verification code is required' }, { status: 400 })
      }

      const normalizedPhone = normalizePhone(phone)
      if (!normalizedPhone) {
        return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
      }

      // ── Find latest session with valid OTP window ────────────────
      const sessions = await venueDb.$queryRawUnsafe<
        Array<{ id: string; customerId: string; otpHash: string; otpExpiresAt: Date }>
      >(
        `SELECT "id", "customerId", "otpHash", "otpExpiresAt"
         FROM "CustomerPortalSession"
         WHERE "locationId" = $1
           AND "phone" = $2
           AND "otpExpiresAt" > NOW()
           AND "sessionToken" IS NULL
         ORDER BY "createdAt" DESC
         LIMIT 1`,
        locationId,
        normalizedPhone,
      )

      if (sessions.length === 0) {
        return NextResponse.json(
          { error: 'Invalid or expired verification code' },
          { status: 401 },
        )
      }

      const session = sessions[0]

      // ── Verify OTP ───────────────────────────────────────────────
      const valid = verifyOTP(code, session.otpHash, new Date(session.otpExpiresAt))
      if (!valid) {
        return NextResponse.json(
          { error: 'Invalid or expired verification code' },
          { status: 401 },
        )
      }

      // ── Generate session token ───────────────────────────────────
      const sessionToken = generateSessionToken()
      const sessionExpiresAt = getSessionExpiry()

      // ── Update session with token ────────────────────────────────
      await venueDb.$executeRawUnsafe(
        `UPDATE "CustomerPortalSession"
         SET "sessionToken" = $1, "sessionExpiresAt" = $2
         WHERE "id" = $3`,
        sessionToken,
        sessionExpiresAt,
        session.id,
      )

      // ── Set httpOnly cookie ──────────────────────────────────────
      const response = NextResponse.json({
        success: true,
        customerId: session.customerId,
      })

      response.cookies.set('portal_session', sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
      })

      return response
    }

    // ── Unknown action ───────────────────────────────────────────────
    return NextResponse.json(
      { error: 'Invalid action. Use "request-otp" or "verify-otp".' },
      { status: 400 },
    )
  } catch (error) {
    console.error('[POST /api/public/portal/[slug]/auth] Error:', error)
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 })
  }
}
