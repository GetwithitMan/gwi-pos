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
import { err, notFound, ok, unauthorized } from '@/lib/api-response'

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
      return err('Venue slug is required')
    }

    // ── Resolve venue DB ───────────────────────────────────────────────
    let venueDb
    try {
      venueDb = await getDbForVenue(slug)
    } catch {
      return notFound('Location not found')
    }

    // ── Get location ─────────────────────────────────────────────────
    const location = await venueDb.location.findFirst({
      where: { isActive: true },
      select: { id: true, name: true },
    })

    if (!location) {
      return notFound('Location not found')
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
        return err('Phone number is required')
      }

      const normalizedPhone = normalizePhone(phone)
      if (!normalizedPhone) {
        return err('Invalid phone number')
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
      const customers = await venueDb.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Customer"
         WHERE "locationId" = ${locationId} AND "phone" = ${normalizedPhone} AND "deletedAt" IS NULL
         LIMIT 1`

      if (customers.length === 0) {
        // Generic response — do not reveal whether account exists
        return ok({ success: true, message: 'If an account exists, a verification code has been sent.' })
      }

      const customerId = customers[0].id

      // ── Generate OTP ─────────────────────────────────────────────
      const { code, hash, expiresAt } = generateOTP()

      // ── Insert CustomerPortalSession ─────────────────────────────
      const sessionId = crypto.randomUUID()
      await venueDb.$executeRaw`INSERT INTO "CustomerPortalSession" (
          "id", "locationId", "customerId", "phone",
          "otpHash", "otpExpiresAt", "createdAt"
        ) VALUES (${sessionId}, ${locationId}, ${customerId}, ${normalizedPhone}, ${hash}, ${expiresAt}, NOW())`

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

      return ok({ success: true })
    }

    // ═════════════════════════════════════════════════════════════════
    // ACTION: verify-otp
    // ═════════════════════════════════════════════════════════════════
    if (action === 'verify-otp') {
      const { phone, code } = body
      if (!phone || typeof phone !== 'string') {
        return err('Phone number is required')
      }
      if (!code || typeof code !== 'string') {
        return err('Verification code is required')
      }

      const normalizedPhone = normalizePhone(phone)
      if (!normalizedPhone) {
        return err('Invalid phone number')
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
      const sessions = await venueDb.$queryRaw<
        Array<{ id: string; customerId: string; otpHash: string; otpExpiresAt: Date }>>`SELECT "id", "customerId", "otpHash", "otpExpiresAt"
         FROM "CustomerPortalSession"
         WHERE "locationId" = ${locationId}
           AND "phone" = ${normalizedPhone}
           AND "otpExpiresAt" > NOW()
           AND "sessionToken" IS NULL
         ORDER BY "createdAt" DESC
         LIMIT 1`

      if (sessions.length === 0) {
        return unauthorized('Invalid or expired verification code')
      }

      const session = sessions[0]

      // ── Verify OTP ───────────────────────────────────────────────
      const valid = verifyOTP(code, session.otpHash, new Date(session.otpExpiresAt))
      if (!valid) {
        return unauthorized('Invalid or expired verification code')
      }

      // ── Reset throttle on success ──────────────────────────────
      otpVerifyLimiter.reset(`portal-verify:${normalizedPhone}`)

      // ── Fetch customer name ────────────────────────────────────
      const customerRows = await venueDb.$queryRaw<
        Array<{ firstName: string; lastName: string }>>`SELECT "firstName", "lastName" FROM "Customer" WHERE "id" = ${session.customerId}`
      const customerName = customerRows.length > 0
        ? `${customerRows[0].firstName} ${customerRows[0].lastName}`.trim()
        : ''

      // ── Generate session token ───────────────────────────────────
      const sessionToken = generateSessionToken()
      const sessionExpiresAt = getSessionExpiry()

      // ── Update session with token ────────────────────────────────
      await venueDb.$executeRaw`UPDATE "CustomerPortalSession"
         SET "sessionToken" = ${sessionToken}, "sessionExpiresAt" = ${sessionExpiresAt}
         WHERE "id" = ${session.id}`

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
        return err('Email is required')
      }

      const normalizedEmail = email.toLowerCase().trim()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return err('Invalid email format')
      }

      // ── Find customer by email + locationId ────────────────────
      const customers = await venueDb.$queryRaw<
        Array<{ id: string; firstName: string; lastName: string }>>`SELECT "id", "firstName", "lastName" FROM "Customer"
         WHERE "locationId" = ${locationId} AND LOWER("email") = ${normalizedEmail} AND "deletedAt" IS NULL
         LIMIT 1`

      // Always return success — don't reveal whether account exists
      if (customers.length === 0) {
        return ok({
          success: true,
          message: 'If an account exists with that email, a login link has been sent.',
        })
      }

      const customer = customers[0]
      const nonce = crypto.randomUUID()

      // ── Store nonce in session (otpHash field) ─────────────────
      const sessionId = crypto.randomUUID()
      await venueDb.$executeRaw`INSERT INTO "CustomerPortalSession" (
          "id", "locationId", "customerId", "email",
          "otpHash", "otpExpiresAt", "createdAt"
        ) VALUES (${sessionId}, ${locationId}, ${customer.id}, ${normalizedEmail}, ${nonce}, ${new Date(Date.now() + 15 * 60 * 1000)}, NOW())`

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

      return ok({
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
        return err('Token is required')
      }

      // ── Verify HMAC signature ──────────────────────────────────
      const result = verifyMagicLinkToken(token)
      if (!result.valid) {
        return unauthorized(result.expired ? 'This login link has expired.' : 'Invalid login link.')
      }

      // ── Verify slug matches token to prevent cross-venue token reuse ──
      if (result.slug !== slug) {
        return unauthorized('Invalid link')
      }

      // ── Find session by nonce ──────────────────────────────────
      const sessions = await venueDb.$queryRaw<
        Array<{ id: string; customerId: string }>>`SELECT "id", "customerId"
         FROM "CustomerPortalSession"
         WHERE "locationId" = ${locationId}
           AND "otpHash" = ${result.nonce}
           AND "otpExpiresAt" > NOW()
           AND "sessionToken" IS NULL
         LIMIT 1`

      if (sessions.length === 0) {
        return unauthorized('This login link has already been used or expired.')
      }

      const magicSession = sessions[0]

      // ── Fetch customer data ────────────────────────────────────
      const customerRows = await venueDb.$queryRaw<
        Array<{ firstName: string; lastName: string; email: string | null; phone: string | null }>>`SELECT "firstName", "lastName", "email", "phone" FROM "Customer" WHERE "id" = ${magicSession.customerId}`

      const customerName = customerRows.length > 0
        ? `${customerRows[0].firstName} ${customerRows[0].lastName}`.trim()
        : ''

      // ── Generate session token ─────────────────────────────────
      const sessionToken = generateSessionToken()
      const sessionExpiresAt = getSessionExpiry()

      // ── Update session with token (consumes the nonce) ─────────
      await venueDb.$executeRaw`UPDATE "CustomerPortalSession"
         SET "sessionToken" = ${sessionToken}, "sessionExpiresAt" = ${sessionExpiresAt}, "otpHash" = NULL
         WHERE "id" = ${magicSession.id}`

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
        return ok({ authenticated: false })
      }

      const sessions = await venueDb.$queryRaw<
        Array<{ id: string; customerId: string }>>`SELECT "id", "customerId"
         FROM "CustomerPortalSession"
         WHERE "locationId" = ${locationId}
           AND "sessionToken" = ${sessionToken}
           AND "sessionExpiresAt" > NOW()
         LIMIT 1`

      if (sessions.length === 0) {
        return ok({ authenticated: false })
      }

      const { customerId } = sessions[0]

      const customerRows = await venueDb.$queryRaw<
        Array<{
          id: string
          firstName: string
          lastName: string
          email: string | null
          phone: string | null
          loyaltyPoints: number
        }>>`SELECT "id", "firstName", "lastName", "email", "phone", "loyaltyPoints"
         FROM "Customer" WHERE "id" = ${customerId}`

      if (customerRows.length === 0) {
        return ok({ authenticated: false })
      }

      const c = customerRows[0]
      return ok({
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
        await venueDb.$executeRaw`UPDATE "CustomerPortalSession"
           SET "sessionExpiresAt" = NOW()
           WHERE "locationId" = ${locationId} AND "sessionToken" = ${sessionToken}`
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
    return err('Invalid action.')
  } catch (error) {
    console.error('[POST /api/public/portal/[slug]/auth] Error:', error)
    return err('Authentication failed', 500)
  }
}
