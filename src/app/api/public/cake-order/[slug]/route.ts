/**
 * POST /api/public/cake-order/[slug] — Public cake order submission
 *
 * No authentication. Resolves venue by slug. Rate limited: 3/hr per IP.
 * Honeypot-protected. Idempotent via submissionToken.
 *
 * Validates eventDate lead time + daily capacity. Find-or-creates Customer.
 * Generates orderNumber with advisory lock. Inserts CakeOrder + CakeOrderChange.
 * Fire-and-forget SMS confirmation. Emits socket event.
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getDbForVenue } from '@/lib/db'
import { createRateLimiter } from '@/lib/rate-limiter'
import { getClientIp } from '@/lib/get-client-ip'
import { createCakeOrderSchema } from '@/lib/cake-orders/schemas'
import { DEFAULT_CAKE_ORDERING, type CakeOrderingSettings } from '@/lib/settings'
import { normalizePhone } from '@/lib/utils'
import { dispatchCakeOrderNew } from '@/lib/socket-dispatch'
import { err, forbidden, notFound, ok } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 3_600_000 })

export async function POST(
  request: NextRequest,
  context: any,
) {
  try {
    const { slug } = (await context.params) as { slug: string }

    if (!slug) {
      return err('Venue slug is required')
    }

    // ── Rate limit ─────────────────────────────────────────────────────
    const ip = getClientIp(request)

    const rl = limiter.check(`cake-submit:${ip}`)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait before trying again.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      )
    }

    // ── Resolve venue DB ───────────────────────────────────────────────
    let venueDb
    try {
      venueDb = await getDbForVenue(slug)
    } catch {
      return notFound('Location not found')
    }

    // ── Get location + settings ────────────────────────────────────────
    const location = await venueDb.location.findFirst({
      where: { isActive: true },
      select: { id: true, name: true, phone: true, settings: true },
    })

    if (!location) {
      return notFound('Location not found')
    }

    const settings = location.settings as Record<string, unknown> | null
    const cakeRaw = settings?.cakeOrdering as Partial<CakeOrderingSettings> | null | undefined
    const cakeSettings: CakeOrderingSettings = cakeRaw
      ? { ...DEFAULT_CAKE_ORDERING, ...cakeRaw }
      : DEFAULT_CAKE_ORDERING

    // ── Check cake ordering enabled + public ordering ──────────────────
    if (!cakeSettings.enabled) {
      return forbidden('Cake ordering is not available at this location')
    }

    if (!cakeSettings.allowPublicOrdering) {
      return forbidden('Online cake ordering is not available at this location')
    }

    // ── Parse body ─────────────────────────────────────────────────────
    const body = await request.json()

    // ── Honeypot check ─────────────────────────────────────────────────
    if ('website' in body) {
      return err('Invalid submission', 422)
    }

    // ── Validate body ──────────────────────────────────────────────────
    const parsed = createCakeOrderSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      )
    }
    const input = parsed.data

    // ── Secondary honeypot (_hp field must be empty) ───────────────────
    if (input._hp && input._hp.length > 0) {
      return err('Invalid submission', 422)
    }

    const locationId = location.id

    // ── submissionToken idempotency check ──────────────────────────────
    const existingOrder = await venueDb.$queryRaw<Array<Record<string, unknown>>>`SELECT "id", "orderNumber" FROM "CakeOrder"
       WHERE "locationId" = ${locationId} AND "submissionToken" = ${input.submissionToken} AND "deletedAt" IS NULL
       LIMIT 1`

    if (existingOrder.length > 0) {
      return ok({
        success: true,
        orderNumber: Number(existingOrder[0].orderNumber),
        message: 'Order already submitted.',
      })
    }

    // ── Validate eventDate lead time ───────────────────────────────────
    const eventDate = new Date(input.eventDate + 'T00:00:00')
    const now = new Date()
    const hoursUntilEvent = (eventDate.getTime() - now.getTime()) / (1000 * 60 * 60)

    if (hoursUntilEvent < cakeSettings.hardMinimumLeadTimeHours) {
      return NextResponse.json(
        {
          code: 'LEAD_TIME_VIOLATION',
          message: `Cake orders require at least ${cakeSettings.hardMinimumLeadTimeHours} hours advance notice.`,
        },
        { status: 400 },
      )
    }

    // ── Validate daily capacity ────────────────────────────────────────
    // Advisory lock on locationId:eventDate to serialize capacity check
    await venueDb.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${locationId} || ':' || ${input.eventDate}))`

    const capacityRows = await venueDb.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*) AS count FROM "CakeOrder"
       WHERE "locationId" = ${locationId}
         AND "eventDate" = ${input.eventDate}::date
         AND "status" NOT IN ('cancelled', 'draft')
         AND "deletedAt" IS NULL`
    const currentCount = Number(capacityRows[0]?.count ?? 0)

    if (currentCount >= cakeSettings.maxCapacityPerDay) {
      return NextResponse.json(
        {
          code: 'CAPACITY_EXCEEDED',
          message: `We are fully booked for ${input.eventDate}. Please choose a different date.`,
        },
        { status: 409 },
      )
    }

    // ── Find-or-create Customer ────────────────────────────────────────
    const normalizedPhone = normalizePhone(input.customerPhone)
    let customerId: string | null = null

    if (normalizedPhone) {
      const existingCustomer = await venueDb.$queryRaw<Array<Record<string, unknown>>>`SELECT "id" FROM "Customer"
         WHERE "locationId" = ${locationId} AND "phone" = ${normalizedPhone} AND "deletedAt" IS NULL
         LIMIT 1`

      if (existingCustomer.length > 0) {
        customerId = existingCustomer[0].id as string
      }
    }

    if (!customerId) {
      customerId = crypto.randomUUID()
      await venueDb.$executeRaw`INSERT INTO "Customer" (
          "id", "locationId", "firstName", "lastName", "phone", "email",
          "createdAt", "updatedAt"
        ) VALUES (${customerId}, ${locationId}, ${input.customerFirstName}, ${input.customerLastName}, ${normalizedPhone || input.customerPhone}, ${input.customerEmail || null}, NOW(), NOW())`
    }

    // ── Generate orderNumber with advisory lock ────────────────────────
    const orderNumberRows = await venueDb.$queryRaw<[{ nextval: string | number }]>`SELECT pg_advisory_xact_lock(hashtext(${locationId}::text));
       SELECT COALESCE(MAX("orderNumber"), 0) + 1 AS nextval
       FROM "CakeOrder"
       WHERE "locationId" = ${locationId}`
    const orderNumber = Number(orderNumberRows[0]?.nextval ?? 1)

    // ── INSERT CakeOrder ───────────────────────────────────────────────
    const orderId = crypto.randomUUID()

    await venueDb.$executeRaw`INSERT INTO "CakeOrder" (
        "id", "locationId", "orderNumber", "customerId", "submissionToken",
        "eventDate", "eventTimeStart", "eventTimeEnd", "eventType", "guestCount",
        "deliveryType", "deliveryAddress",
        "cakeConfig", "designConfig", "dietaryConfig",
        "notes", "preferredContactMethod",
        "status", "source",
        "submittedAt", "createdAt", "updatedAt"
      ) VALUES (
        ${orderId}, ${locationId}, ${orderNumber}, ${customerId}, ${input.submissionToken},
        ${input.eventDate}::date, ${input.eventTimeStart || null}, ${input.eventTimeEnd || null}, ${input.eventType}, ${input.guestCount ?? null},
        ${input.deliveryType}, ${input.deliveryAddress || null},
        ${JSON.stringify(input.cakeConfig)}::jsonb, ${JSON.stringify(input.designConfig)}::jsonb, ${JSON.stringify(input.dietaryConfig)}::jsonb,
        ${input.notes || null}, ${input.preferredContactMethod || null},
        'submitted', 'public_form',
        NOW(), NOW(), NOW()
      )`

    // ── INSERT CakeOrderChange (audit trail) ───────────────────────────
    const changeId = crypto.randomUUID()
    const changeDetails = JSON.stringify({
      previousStatus: null,
      newStatus: 'submitted',
      trigger: 'public_form_submission',
      customerName: `${input.customerFirstName} ${input.customerLastName}`,
      eventDate: input.eventDate,
      eventType: input.eventType,
    })
    await venueDb.$executeRaw`INSERT INTO "CakeOrderChange" (
        "id", "cakeOrderId", "changeType", "changedBy", "source",
        "details", "createdAt"
      ) VALUES (
        ${changeId}, ${orderId}, 'status_change', NULL, 'public_form',
        ${changeDetails}::jsonb, NOW()
      )`

    // ── Fire-and-forget SMS confirmation ───────────────────────────────
    void (async () => {
      try {
        const { sendSMS } = await import('@/lib/twilio')
        const phone = normalizedPhone || input.customerPhone
        if (!phone) return

        const message = [
          `Thank you for your cake order with ${location.name}!`,
          `Order #${orderNumber} for ${input.eventDate} has been received.`,
          `We will review your order and follow up with a quote.`,
          location.phone ? `Questions? Call us at ${location.phone}.` : null,
        ].filter(Boolean).join(' ')

        await sendSMS({ to: phone, body: message })
      } catch (err) {
        console.error('[public-cake-order] SMS confirmation failed:', err)
      }
    })()

    // ── Socket event ───────────────────────────────────────────────────
    void dispatchCakeOrderNew(locationId, {
      cakeOrderId: orderId,
      customerName: `${input.customerFirstName} ${input.customerLastName}`.trim(),
      eventDate: input.eventDate,
      source: 'public_form',
    }).catch(err => console.error('[public-cake-order] Socket dispatch failed:', err))

    return ok({ success: true })
  } catch (error) {
    console.error('[POST /api/public/cake-order/[slug]] Error:', error)
    return err('Failed to submit cake order', 500)
  }
}
