/**
 * POST /api/orders/[id]/payment-link
 *
 * Creates a secure payment link for an order and sends it via SMS and/or email.
 * The link allows a customer to pay their bill remotely using a credit card
 * (Datacap keyedSale — card-not-present).
 *
 * Requires: authenticated employee with process_payments permission.
 */

import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getLocationId } from '@/lib/location-cache'
import { parseSettings, type TextToPaySettings, DEFAULT_TEXT_TO_PAY } from '@/lib/settings'
import { sendSMS } from '@/lib/twilio'
import { sendEmail } from '@/lib/email-service'
import { withVenue } from '@/lib/with-venue'

const CreatePaymentLinkSchema = z.object({
  employeeId: z.string().min(1),
  phoneNumber: z.string().optional(),
  email: z.string().email().optional(),
  expirationMinutes: z.number().min(5).max(1440).optional(), // 5 min to 24 hours
})

export const POST = withVenue(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  try {
    const { id: orderId } = await context.params
    const body = await request.json()
    const parsed = CreatePaymentLinkSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { employeeId, phoneNumber, email, expirationMinutes } = parsed.data

    // Must provide at least one delivery method
    if (!phoneNumber && !email) {
      return NextResponse.json(
        { error: 'At least one of phoneNumber or email is required' },
        { status: 400 }
      )
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'Location not found' }, { status: 400 })
    }

    // Auth check
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.POS_CARD_PAYMENTS)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Get location settings
    const location = await db.location.findFirst({
      where: { id: locationId },
      select: { name: true, settings: true, slug: true },
    })
    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    const settings = parseSettings(location.settings)
    const textToPaySettings: TextToPaySettings = settings.textToPay
      ? { ...DEFAULT_TEXT_TO_PAY, ...settings.textToPay }
      : DEFAULT_TEXT_TO_PAY

    if (!textToPaySettings.enabled) {
      return NextResponse.json(
        { error: 'Text-to-Pay is not enabled for this location' },
        { status: 403 }
      )
    }

    // Fetch order
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        locationId: true,
        orderNumber: true,
        total: true,
        status: true,
        payments: {
          where: { status: 'completed' },
          select: { totalAmount: true },
        },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }
    if (order.locationId !== locationId) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }
    if (order.status === 'paid' || order.status === 'voided' || order.status === 'cancelled') {
      return NextResponse.json(
        { error: `Cannot create payment link for ${order.status} order` },
        { status: 400 }
      )
    }

    // Calculate outstanding balance
    const total = Number(order.total ?? 0)
    const paidAmount = order.payments.reduce((sum, p) => sum + Number(p.totalAmount), 0)
    const balance = Math.max(0, total - paidAmount)

    if (balance <= 0) {
      return NextResponse.json(
        { error: 'Order is already fully paid' },
        { status: 400 }
      )
    }

    // Cancel any existing pending links for this order
    await db.$executeRawUnsafe(`
      UPDATE "PaymentLink"
      SET "status" = 'cancelled', "updatedAt" = NOW()
      WHERE "orderId" = $1 AND "status" = 'pending'
    `, orderId)

    // Generate secure token
    const token = crypto.randomUUID()

    // Calculate expiration
    const expMinutes = expirationMinutes || textToPaySettings.defaultExpirationMinutes || 60
    const expiresAt = new Date(Date.now() + expMinutes * 60 * 1000)

    // Create PaymentLink record
    await db.$executeRawUnsafe(`
      INSERT INTO "PaymentLink" (
        "id", "locationId", "orderId", "token", "amount", "status",
        "expiresAt", "phoneNumber", "email", "createdByEmployeeId",
        "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text, $1, $2, $3, $4, 'pending',
        $5, $6, $7, $8,
        NOW(), NOW()
      )
    `,
      locationId,
      orderId,
      token,
      balance,
      expiresAt,
      phoneNumber || null,
      email || null,
      employeeId
    )

    // Build payment link URL
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3005'
    const payUrl = `${baseUrl}/pay/${token}`

    // Send SMS (fire-and-forget)
    if (phoneNumber) {
      const smsBody = textToPaySettings.smsTemplate
        .replace('{venue}', location.name)
        .replace('{link}', payUrl)
        .replace('{amount}', `$${balance.toFixed(2)}`)

      void sendSMS({
        to: phoneNumber,
        body: smsBody,
      }).catch(err => console.error('[text-to-pay] SMS send failed:', err))
    }

    // Send email (fire-and-forget)
    if (email) {
      void sendEmail({
        to: email,
        subject: `Pay your bill at ${location.name}`,
        html: buildPaymentLinkEmail(location.name, payUrl, balance, expMinutes),
      }).catch(err => console.error('[text-to-pay] Email send failed:', err))
    }

    return NextResponse.json({
      data: {
        link: payUrl,
        token,
        amount: balance,
        expiresAt: expiresAt.toISOString(),
        sentTo: {
          phone: phoneNumber || null,
          email: email || null,
        },
      },
    })
  } catch (error) {
    console.error('[POST /api/orders/[id]/payment-link] Error:', error)
    return NextResponse.json({ error: 'Failed to create payment link' }, { status: 500 })
  }
})

// ── Email Template ──────────────────────────────────────────────────────────

function buildPaymentLinkEmail(
  venueName: string,
  payUrl: string,
  amount: number,
  expirationMinutes: number,
): string {
  const expiresText = expirationMinutes >= 60
    ? `${Math.round(expirationMinutes / 60)} hour${expirationMinutes >= 120 ? 's' : ''}`
    : `${expirationMinutes} minutes`

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5;">
      <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        <div style="background: #1f2937; color: white; padding: 24px; text-align: center;">
          <h1 style="margin: 0; font-size: 22px; font-weight: 600;">${venueName}</h1>
          <p style="margin: 8px 0 0 0; opacity: 0.8; font-size: 14px;">Payment Request</p>
        </div>
        <div style="padding: 32px 24px; text-align: center;">
          <p style="margin: 0 0 8px 0; font-size: 16px; color: #6b7280;">Amount Due</p>
          <p style="margin: 0 0 24px 0; font-size: 36px; font-weight: 700; color: #1f2937;">$${amount.toFixed(2)}</p>
          <a href="${payUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600;">
            Pay Now
          </a>
          <p style="margin: 20px 0 0 0; font-size: 12px; color: #9ca3af;">
            This link expires in ${expiresText}.
          </p>
        </div>
        <div style="padding: 16px 24px; background: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center;">
          <p style="margin: 0; font-size: 11px; color: #9ca3af;">
            Secure payment powered by Datacap. Your card information is never stored.
          </p>
        </div>
      </div>
    </body>
    </html>
  `
}
