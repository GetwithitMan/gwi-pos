/**
 * POST /api/public/portal/[slug]/auth — Customer portal authentication
 *
 * Actions:
 *   action='request-otp'        — Rate-limited 3/phone/10min. Sends OTP via SMS.
 *   action='verify-otp'         — Verifies OTP, creates session, sets httpOnly cookie.
 *   action='request-magic-link' — Sends HMAC-signed magic link via email.
 *   action='verify-magic-link'  — Verifies magic link token, creates session.
 *   action='check-session'      — Validates portal_session cookie, returns customer data.
 *   action='logout'             — Clears portal_session cookie.
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
  generateMagicLinkToken,
  verifyMagicLinkToken,
} from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

// 3 OTP requests per phone per 10 minutes
const otpLimiter = createRateLimiter({ maxAttempts: 3, windowMs: 10 * 60 * 1000 })

// 5 failed OTP verify attempts per phone per 15 minutes
const otpVerifyLimiter = createRateLimiter({ maxAttempts: 5, windowMs: 15 * 60 * 1000 })

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
      venueDb = await getDbForVenue(slug)
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

      // ── Brute-force throttle ───────────────────────────────────
      const verifyRl = otpVerifyLimiter.check(`portal-verify:${normalizedPhone}`)
      if (!verifyRl.allowed) {
        return NextResponse.json(
          { error: 'Too many failed attempts. Please wait before trying again.' },
          { status: 429, headers: { 'Retry-After': String(verifyRl.retryAfter) } },
        )
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

      // ── Reset throttle on success ──────────────────────────────
      otpVerifyLimiter.reset(`portal-verify:${normalizedPhone}`)

      // ── Fetch customer name ────────────────────────────────────
      const customerRows = await venueDb.$queryRawUnsafe<
        Array<{ firstName: string; lastName: string }>
      >(
        `SELECT "firstName", "lastName" FROM "Customer" WHERE "id" = $1`,
        session.customerId,
      )
      const customerName = customerRows.length > 0
        ? `${customerRows[0].firstName} ${customerRows[0].lastName}`.trim()
        : ''

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
        customerName,
      })

      response.cookies.set('portal_session', sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60,
      })

      return response
    }

    // ═════════════════════════════════════════════════════════════════
    // ACTION: request-magic-link
    // ═════════════════════════════════════════════════════════════════
    if (action === 'request-magic-link') {
      const { email } = body
      if (!email || typeof email !== 'string') {
        return NextResponse.json({ error: 'Email is required' }, { status: 400 })
      }

      const normalizedEmail = email.toLowerCase().trim()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
      }

      // ── Find customer by email + locationId ────────────────────
      const customers = await venueDb.$queryRawUnsafe<
        Array<{ id: string; firstName: string; lastName: string }>
      >(
        `SELECT "id", "firstName", "lastName" FROM "Customer"
         WHERE "locationId" = $1 AND LOWER("email") = $2 AND "deletedAt" IS NULL
         LIMIT 1`,
        locationId,
        normalizedEmail,
      )

      // Always return success — don't reveal whether account exists
      if (customers.length === 0) {
        return NextResponse.json({
          success: true,
          message: 'If an account exists with that email, a login link has been sent.',
        })
      }

      const customer = customers[0]
      const nonce = crypto.randomUUID()

      // ── Store nonce in session (otpHash field) ─────────────────
      const sessionId = crypto.randomUUID()
      await venueDb.$executeRawUnsafe(
        `INSERT INTO "CustomerPortalSession" (
          "id", "locationId", "customerId", "email",
          "otpHash", "otpExpiresAt", "createdAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        sessionId,
        locationId,
        customer.id,
        normalizedEmail,
        nonce,
        new Date(Date.now() + 15 * 60 * 1000),
      )

      // ── Generate HMAC-signed token ─────────────────────────────
      const signedToken = generateMagicLinkToken(nonce, slug, customer.id)

      // ── Send email (fire-and-forget) ───────────────────────────
      void (async () => {
        try {
          const { sendEmail } = await import('@/lib/email-service')
          const loginUrl = `https://${slug}.ordercontrolcenter.com/account?token=${encodeURIComponent(signedToken)}`
          await sendEmail({
            to: normalizedEmail,
            subject: `Log in to ${location.name}`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
                <h2 style="margin: 0 0 16px 0; font-size: 24px; color: #111;">Log in to ${location.name}</h2>
                <p style="margin: 0 0 24px 0; color: #555; line-height: 1.5;">
                  Hi ${customer.firstName}, click the button below to access your account.
                </p>
                <a href="${loginUrl}"
                   style="display: inline-block; padding: 12px 32px; background: #111; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;">
                  Log In
                </a>
                <p style="margin: 24px 0 0 0; color: #999; font-size: 13px;">
                  This link expires in 15 minutes. If you didn't request this, you can safely ignore it.
                </p>
              </div>
            `,
          })
        } catch (err) {
          console.error('[portal-auth] Magic link email failed:', err)
        }
      })()

      return NextResponse.json({
        success: true,
        message: 'If an account exists with that email, a login link has been sent.',
      })
    }

    // ═════════════════════════════════════════════════════════════════
    // ACTION: verify-magic-link
    // ═════════════════════════════════════════════════════════════════
    if (action === 'verify-magic-link') {
      const { token } = body
      if (!token || typeof token !== 'string') {
        return NextResponse.json({ error: 'Token is required' }, { status: 400 })
      }

      // ── Verify HMAC signature ──────────────────────────────────
      const result = verifyMagicLinkToken(token)
      if (!result.valid) {
        return NextResponse.json(
          { error: result.expired ? 'This login link has expired.' : 'Invalid login link.' },
          { status: 401 },
        )
      }

      // ── Find session by nonce ──────────────────────────────────
      const sessions = await venueDb.$queryRawUnsafe<
        Array<{ id: string; customerId: string }>
      >(
        `SELECT "id", "customerId"
         FROM "CustomerPortalSession"
         WHERE "locationId" = $1
           AND "otpHash" = $2
           AND "otpExpiresAt" > NOW()
           AND "sessionToken" IS NULL
         LIMIT 1`,
        locationId,
        result.nonce,
      )

      if (sessions.length === 0) {
        return NextResponse.json(
          { error: 'This login link has already been used or expired.' },
          { status: 401 },
        )
      }

      const magicSession = sessions[0]

      // ── Fetch customer data ────────────────────────────────────
      const customerRows = await venueDb.$queryRawUnsafe<
        Array<{ firstName: string; lastName: string; email: string | null; phone: string | null }>
      >(
        `SELECT "firstName", "lastName", "email", "phone" FROM "Customer" WHERE "id" = $1`,
        magicSession.customerId,
      )

      const customerName = customerRows.length > 0
        ? `${customerRows[0].firstName} ${customerRows[0].lastName}`.trim()
        : ''

      // ── Generate session token ─────────────────────────────────
      const sessionToken = generateSessionToken()
      const sessionExpiresAt = getSessionExpiry()

      // ── Update session with token (consumes the nonce) ─────────
      await venueDb.$executeRawUnsafe(
        `UPDATE "CustomerPortalSession"
         SET "sessionToken" = $1, "sessionExpiresAt" = $2, "otpHash" = NULL
         WHERE "id" = $3`,
        sessionToken,
        sessionExpiresAt,
        magicSession.id,
      )

      // ── Set httpOnly cookie ────────────────────────────────────
      const response = NextResponse.json({
        success: true,
        customerId: magicSession.customerId,
        customerName,
      })

      response.cookies.set('portal_session', sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60,
      })

      return response
    }

    // ═════════════════════════════════════════════════════════════════
    // ACTION: check-session
    // ═════════════════════════════════════════════════════════════════
    if (action === 'check-session') {
      const sessionToken = request.cookies.get('portal_session')?.value
      if (!sessionToken) {
        return NextResponse.json({ authenticated: false })
      }

      const sessions = await venueDb.$queryRawUnsafe<
        Array<{ id: string; customerId: string }>
      >(
        `SELECT "id", "customerId"
         FROM "CustomerPortalSession"
         WHERE "locationId" = $1
           AND "sessionToken" = $2
           AND "sessionExpiresAt" > NOW()
         LIMIT 1`,
        locationId,
        sessionToken,
      )

      if (sessions.length === 0) {
        return NextResponse.json({ authenticated: false })
      }

      const { customerId } = sessions[0]

      const customerRows = await venueDb.$queryRawUnsafe<
        Array<{
          id: string
          firstName: string
          lastName: string
          email: string | null
          phone: string | null
          loyaltyPoints: number
        }>
      >(
        `SELECT "id", "firstName", "lastName", "email", "phone", "loyaltyPoints"
         FROM "Customer" WHERE "id" = $1`,
        customerId,
      )

      if (customerRows.length === 0) {
        return NextResponse.json({ authenticated: false })
      }

      const c = customerRows[0]
      return NextResponse.json({
        authenticated: true,
        customer: {
          id: c.id,
          name: `${c.firstName} ${c.lastName}`.trim(),
          email: c.email,
          phone: c.phone,
          loyaltyPoints: Number(c.loyaltyPoints ?? 0),
        },
      })
    }

    // ═════════════════════════════════════════════════════════════════
    // ACTION: logout
    // ═════════════════════════════════════════════════════════════════
    if (action === 'logout') {
      const sessionToken = request.cookies.get('portal_session')?.value
      if (sessionToken) {
        // Invalidate session in DB
        await venueDb.$executeRawUnsafe(
          `UPDATE "CustomerPortalSession"
           SET "sessionExpiresAt" = NOW()
           WHERE "locationId" = $1 AND "sessionToken" = $2`,
          locationId,
          sessionToken,
        )
      }

      const response = NextResponse.json({ success: true })
      response.cookies.set('portal_session', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
      })
      return response
    }

    // ── Unknown action ───────────────────────────────────────────────
    return NextResponse.json(
      { error: 'Invalid action.' },
      { status: 400 },
    )
  } catch (error) {
    console.error('[POST /api/public/portal/[slug]/auth] Error:', error)
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 })
  }
}
