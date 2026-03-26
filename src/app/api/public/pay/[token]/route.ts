/**
 * Public Payment Link API
 *
 * GET  /api/public/pay/[token] — Fetch order summary for payment page (no auth)
 * POST /api/public/pay/[token] — Process card payment via Datacap keyedSale (no auth)
 *
 * SECURITY:
 * - Rate limited per IP (10 GET/min, 5 POST/min)
 * - Card data is NEVER logged or stored — passed directly to Datacap in memory
 * - Token is a crypto.randomUUID — not guessable
 * - Expired/completed/cancelled links are rejected
 */

import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDbForVenue } from '@/lib/db'
import { parseSettings, DEFAULT_TEXT_TO_PAY } from '@/lib/settings'
import { getDatacapClient } from '@/lib/datacap/helpers'
import { dispatchPaymentProcessed, dispatchOpenOrdersChanged, dispatchOrderTotalsUpdate } from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('public.pay.token')

// ── Rate Limiting ───────────────────────────────────────────────────────────

const getRateLimitMap = new Map<string, { count: number; resetAt: number }>()
const postRateLimitMap = new Map<string, { count: number; resetAt: number }>()
const GET_RATE_LIMIT = 10
const POST_RATE_LIMIT = 5
const RATE_WINDOW_MS = 60_000

function checkRateLimit(
  map: Map<string, { count: number; resetAt: number }>,
  ip: string,
  limit: number
): boolean {
  const now = Date.now()
  const entry = map.get(ip)

  if (!entry || now > entry.resetAt) {
    map.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }

  if (entry.count >= limit) return false
  entry.count++
  return true
}

// Periodic cleanup (every 5 minutes)
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of getRateLimitMap) {
    if (now > val.resetAt) getRateLimitMap.delete(key)
  }
  for (const [key, val] of postRateLimitMap) {
    if (now > val.resetAt) postRateLimitMap.delete(key)
  }
}, 300_000)

function getIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown'
}

// ── Shared: look up PaymentLink + venue DB ──────────────────────────────────

interface PaymentLinkRow {
  id: string
  locationId: string
  orderId: string
  token: string
  amount: string
  tipAmount: string
  status: string
  expiresAt: Date
  phoneNumber: string | null
  email: string | null
  completedAt: Date | null
  paymentId: string | null
}

/**
 * Because this is a public endpoint with no x-venue-slug header, we need to
 * scan all venue DBs for the token. In practice, the NUC only has one venue,
 * and Vercel multi-tenant routes through a single DB.
 * We use a master DB query here since PaymentLink stores locationId.
 */
async function findPaymentLink(token: string): Promise<{
  link: PaymentLinkRow
  db: any
  slug: string
} | null> {
  // Try direct DB first (NUC has only one DB)
  try {
    const { masterClient } = await import('@/lib/db')
    const rows: PaymentLinkRow[] = await masterClient.$queryRawUnsafe(`
      SELECT "id", "locationId", "orderId", "token", "amount", "tipAmount",
             "status", "expiresAt", "phoneNumber", "email", "completedAt", "paymentId"
      FROM "PaymentLink"
      WHERE "token" = $1
      LIMIT 1
    `, token)

    if (rows.length > 0) {
      const row = rows[0]
      // Try to get venue-scoped DB via location slug
      let venueDb = masterClient
      let slug = ''

      try {
        const slugRows = await masterClient.$queryRawUnsafe(`
          SELECT "slug" FROM "Location" WHERE "id" = $1 LIMIT 1
        `, row.locationId) as { slug: string }[]

        slug = slugRows[0]?.slug || ''
        if (slug) venueDb = await getDbForVenue(slug)
      } catch {
        // Fall back to masterClient
      }

      return { link: row, db: venueDb, slug }
    }
  } catch (err) {
    console.error('[public/pay] Error looking up payment link:', err)
  }

  return null
}

// ── GET: Fetch order summary ────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const ip = getIp(request)
    if (!checkRateLimit(getRateLimitMap, ip, GET_RATE_LIMIT)) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      )
    }

    const { token } = await context.params
    if (!token || token.length < 30) {
      return NextResponse.json({ error: 'Invalid payment link' }, { status: 400 })
    }

    const result = await findPaymentLink(token)
    if (!result) {
      return NextResponse.json({ error: 'Payment link not found' }, { status: 404 })
    }

    const { link, db: venueDb } = result

    // Check status
    if (link.status === 'completed') {
      return NextResponse.json({ error: 'This payment has already been completed', status: 'completed' }, { status: 410 })
    }
    if (link.status === 'cancelled') {
      return NextResponse.json({ error: 'This payment link has been cancelled', status: 'cancelled' }, { status: 410 })
    }
    if (link.status === 'expired' || new Date(link.expiresAt) < new Date()) {
      // Auto-expire if not already marked
      if (link.status !== 'expired') {
        await venueDb.$executeRawUnsafe(`
          UPDATE "PaymentLink" SET "status" = 'expired', "updatedAt" = NOW()
          WHERE "id" = $1
        `, link.id)
      }
      return NextResponse.json({ error: 'This payment link has expired', status: 'expired' }, { status: 410 })
    }

    // Fetch order details (non-sensitive)
    const order = await venueDb.order.findUnique({
      where: { id: link.orderId },
      select: {
        id: true,
        orderNumber: true,
        subtotal: true,
        taxTotal: true,
        total: true,
        paidTotal: true,
        items: {
          where: { deletedAt: null, voidedAt: null },
          select: {
            id: true,
            name: true,
            quantity: true,
            price: true,
            itemTotal: true,
            tipExempt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Fetch location name + settings
    const location = await venueDb.location.findFirst({
      where: { id: link.locationId },
      select: { name: true, settings: true },
    })

    const settings = location ? parseSettings(location.settings) : null
    const textToPaySettings = settings?.textToPay
      ? { ...DEFAULT_TEXT_TO_PAY, ...settings.textToPay }
      : DEFAULT_TEXT_TO_PAY

    const amount = Number(link.amount)

    // Compute tip-exempt amount from order items
    const tipExemptAmount = order.items
      .filter((i: any) => i.tipExempt)
      .reduce((sum: number, i: any) => sum + (Number(i.itemTotal) || Number(i.price) * (i.quantity || 1)), 0)

    return NextResponse.json({
      data: {
        venueName: location?.name || 'Restaurant',
        orderNumber: order.orderNumber,
        items: order.items.map((item: { name: string; quantity: number; price: unknown }) => ({
          name: item.name,
          quantity: item.quantity,
          price: Number(item.price),
        })),
        subtotal: Number(order.subtotal ?? 0),
        tax: Number(order.taxTotal ?? 0),
        total: Number(order.total ?? 0),
        amountDue: amount,
        allowTip: textToPaySettings.allowTipOnLink,
        tipSuggestions: settings?.tips?.suggestedPercentages || [15, 18, 20],
        expiresAt: link.expiresAt,
        ...(tipExemptAmount > 0 ? { tipExemptAmount } : {}),
      },
    })
  } catch (error) {
    console.error('[GET /api/public/pay/[token]] Error:', error)
    return NextResponse.json({ error: 'Failed to load payment details' }, { status: 500 })
  }
}

// ── POST: Process payment ───────────────────────────────────────────────────

const ProcessPaymentSchema = z.object({
  cardNumber: z.string().min(13).max(19),
  expMonth: z.string().regex(/^(0[1-9]|1[0-2])$/),
  expYear: z.string().regex(/^\d{2}$/),
  cvv: z.string().min(3).max(4),
  zipCode: z.string().min(5).max(10).optional(),
  tipAmount: z.number().min(0).max(10000).optional(),
})

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const ip = getIp(request)
    if (!checkRateLimit(postRateLimitMap, ip, POST_RATE_LIMIT)) {
      return NextResponse.json(
        { error: 'Too many attempts. Please wait and try again.' },
        { status: 429 }
      )
    }

    const { token } = await context.params
    if (!token || token.length < 30) {
      return NextResponse.json({ error: 'Invalid payment link' }, { status: 400 })
    }

    const body = await request.json()
    const parsed = ProcessPaymentSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid payment details', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { cardNumber, expMonth, expYear, cvv, zipCode, tipAmount } = parsed.data

    // Look up payment link
    const result = await findPaymentLink(token)
    if (!result) {
      return NextResponse.json({ error: 'Payment link not found' }, { status: 404 })
    }

    const { link, db: venueDb } = result

    // Validate link status
    if (link.status === 'completed') {
      return NextResponse.json({ error: 'This payment has already been completed' }, { status: 410 })
    }
    if (link.status === 'cancelled') {
      return NextResponse.json({ error: 'This payment link has been cancelled' }, { status: 410 })
    }
    if (link.status === 'expired' || new Date(link.expiresAt) < new Date()) {
      return NextResponse.json({ error: 'This payment link has expired' }, { status: 410 })
    }

    // Fetch order to confirm it's still unpaid
    const order = await venueDb.order.findUnique({
      where: { id: link.orderId },
      select: {
        id: true,
        locationId: true,
        orderNumber: true,
        subtotal: true,
        taxTotal: true,
        tipTotal: true,
        discountTotal: true,
        total: true,
        paidTotal: true,
        status: true,
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }
    if (order.status === 'paid' || order.status === 'voided') {
      return NextResponse.json({ error: 'This order has already been settled' }, { status: 410 })
    }

    const amount = Number(link.amount)
    const tip = tipAmount || 0
    const totalCharge = amount + tip

    // Get a payment reader for Datacap keyedSale
    // keyedSale uses cloud mode — pick the first active reader for the location
    const readers = await venueDb.paymentReader.findMany({
      where: { locationId: link.locationId, isActive: true, deletedAt: null },
      select: { id: true },
      take: 1,
    })

    if (readers.length === 0) {
      return NextResponse.json(
        { error: 'Payment processing is not available. Please contact the venue.' },
        { status: 503 }
      )
    }

    const readerId = readers[0].id

    // Process payment via Datacap keyedSale (card data only in memory — never logged)
    const datacapClient = await getDatacapClient(link.locationId)
    const invoiceNo = `TTP-${order.orderNumber}`

    const datacapResponse = await datacapClient.keyedSale(readerId, {
      invoiceNo,
      amounts: {
        purchase: amount,
        gratuity: tip > 0 ? tip : undefined,
      },
      cardNumber,     // NEVER logged — passed directly to Datacap
      expiryMonth: expMonth,
      expiryYear: expYear,
      cvv,            // NEVER logged — passed directly to Datacap
      zipCode,
    })

    // Check if payment was approved
    if (datacapResponse.cmdStatus !== 'Approved') {
      const errorMsg = datacapResponse.textResponse || 'Payment declined'
      return NextResponse.json(
        { error: errorMsg, declined: true },
        { status: 402 }
      )
    }

    // Create Payment record
    const paymentId = crypto.randomUUID()
    const now = new Date()
    const cardLast4 = datacapResponse.cardLast4 || cardNumber.slice(-4)
    const cardBrand = datacapResponse.cardType || 'unknown'

    await venueDb.$executeRawUnsafe(`
      INSERT INTO "Payment" (
        "id", "locationId", "orderId", "paymentMethod", "amount", "tipAmount",
        "totalAmount", "status", "cardLast4", "cardBrand", "authCode",
        "datacapRecordNo", "datacapRefNumber", "entryMethod",
        "processedAt", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, 'credit'::"PaymentMethod", $4, $5,
        $6, 'completed'::"PaymentStatus", $7, $8, $9,
        $10, $11, 'Manual',
        $12, $12, $12
      )
    `,
      paymentId,
      link.locationId,
      link.orderId,
      amount,
      tip,
      totalCharge,
      cardLast4,
      cardBrand,
      datacapResponse.authCode || null,
      datacapResponse.recordNo || null,
      datacapResponse.refNo || null,
      now
    )

    // Update order paidTotal and status
    const newPaidTotal = Number(order.paidTotal ?? 0) + totalCharge
    const effectiveTotal = Number(order.total ?? 0)
    const orderIsPaid = newPaidTotal >= effectiveTotal - 0.01 // penny tolerance

    await venueDb.$executeRawUnsafe(`
      UPDATE "Order"
      SET "paidTotal" = $1,
          "status" = $2,
          "tipTotal" = COALESCE("tipTotal", 0) + $3,
          "updatedAt" = NOW()
      WHERE "id" = $4
    `,
      newPaidTotal,
      orderIsPaid ? 'paid' : 'partial',
      tip,
      link.orderId
    )

    // Mark PaymentLink as completed
    await venueDb.$executeRawUnsafe(`
      UPDATE "PaymentLink"
      SET "status" = 'completed',
          "completedAt" = NOW(),
          "tipAmount" = $1,
          "paymentId" = $2,
          "updatedAt" = NOW()
      WHERE "id" = $3
    `, tip, paymentId, link.id)

    // Emit order event (fire-and-forget)
    void emitOrderEvent(
      link.locationId,
      link.orderId,
      'PAYMENT_APPLIED',
      {
        paymentId,
        paymentMethod: 'credit',
        amount,
        tipAmount: tip,
        totalAmount: totalCharge,
        cardLast4,
        source: 'text-to-pay',
      }
    ).catch(err => console.error('[text-to-pay] Failed to emit order event:', err))

    // Socket dispatch (fire-and-forget) — notify terminals the order is updated
    void dispatchPaymentProcessed(link.locationId, {
      orderId: link.orderId,
      paymentId,
      status: 'completed',
    }).catch(err => log.warn({ err }, 'fire-and-forget failed in public.pay.token'))

    void dispatchOrderTotalsUpdate(link.locationId, link.orderId, {
      subtotal: Number(order.subtotal ?? 0),
      taxTotal: Number(order.taxTotal ?? 0),
      tipTotal: Number(order.tipTotal ?? 0) + tip,
      discountTotal: Number(order.discountTotal ?? 0),
      total: effectiveTotal,
    }).catch(err => log.warn({ err }, 'fire-and-forget failed in public.pay.token'))

    if (orderIsPaid) {
      void dispatchOpenOrdersChanged(link.locationId, {
        trigger: 'paid',
        orderId: link.orderId,
      }).catch(err => log.warn({ err }, 'fire-and-forget failed in public.pay.token'))
    }

    return NextResponse.json({
      data: {
        success: true,
        paymentId,
        amount,
        tipAmount: tip,
        totalCharged: totalCharge,
        cardLast4,
        orderPaid: orderIsPaid,
      },
    })
  } catch (error) {
    console.error('[POST /api/public/pay/[token]] Error:', error)

    // Don't expose internal errors to public endpoint
    return NextResponse.json(
      { error: 'Payment processing failed. Please try again or contact the venue.' },
      { status: 500 }
    )
  }
}
