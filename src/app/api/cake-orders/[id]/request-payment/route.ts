/**
 * POST /api/cake-orders/[id]/request-payment — Send text-to-pay link for cake deposit/balance
 *
 * Permission: cake.payment
 *
 * Idempotent: if a pending PaymentLink already exists for the same
 * (cakeOrderId, appliedTo, amount), returns the existing link token.
 * If the amount differs, supersedes old links and creates a new one.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { requestPaymentSchema } from '@/lib/cake-orders/schemas'
import { requestCakePaymentViaText } from '@/lib/cake-orders/cake-payment-service'
import { requireCakeFeature } from '@/lib/cake-orders/require-cake-feature'
import { ok } from '@/lib/api-response'

export const POST = withVenue(async function POST(
  request: NextRequest,
  context: any,
) {
  try {
    const { id: cakeOrderId } = (await context.params) as { id: string }
    const body = await request.json()

    // ── Validate input ──────────────────────────────────────────────────
    const parsed = requestPaymentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      )
    }
    const input = parsed.data

    // ── Resolve actor ───────────────────────────────────────────────────
    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || (body.employeeId as string | undefined)
    const locationId = actor.locationId || (body.locationId as string | undefined)

    if (!locationId) {
      return NextResponse.json(
        { code: 'MISSING_LOCATION', message: 'locationId is required' },
        { status: 400 },
      )
    }

    // ── Permission check ────────────────────────────────────────────────
    const auth = await requirePermission(employeeId, locationId, 'cake.payment')
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    // ── Feature gate ────────────────────────────────────────────────────
    const gate = await requireCakeFeature(locationId)
    if (gate) return gate

    // ── Fetch the cake order ────────────────────────────────────────────
    const orderRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "id", "status", "customerId", "customerPhone", "orderNumber", "locationId"
       FROM "CakeOrder"
       WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      cakeOrderId,
      locationId,
    )

    if (!orderRows || orderRows.length === 0) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: `CakeOrder ${cakeOrderId} not found` },
        { status: 404 },
      )
    }

    const cakeOrder = orderRows[0]
    const currentStatus = cakeOrder.status as string

    // Validate order is in a payable status
    const payableStatuses = ['approved', 'deposit_paid', 'in_production', 'ready', 'delivered']
    if (!payableStatuses.includes(currentStatus)) {
      return NextResponse.json(
        {
          code: 'INVALID_STATUS',
          message: `Cannot request payment when order is in status '${currentStatus}'. Order must be approved or later.`,
        },
        { status: 409 },
      )
    }

    // Validate customer phone exists
    const customerPhone = cakeOrder.customerPhone as string | null
    if (!customerPhone) {
      return NextResponse.json(
        { code: 'NO_PHONE', message: 'Customer phone number is required for text-to-pay' },
        { status: 400 },
      )
    }

    // Validate customerId exists (needed for settlement order)
    const customerId = cakeOrder.customerId as string | null
    if (!customerId) {
      return NextResponse.json(
        { code: 'NO_CUSTOMER', message: 'CakeOrder has no linked customer. Cannot create text-to-pay.' },
        { status: 400 },
      )
    }

    // ── Idempotency check ───────────────────────────────────────────────
    // Check for existing pending PaymentLink for same (cakeOrderId, appliedTo)
    const existingLinks = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT pl."token", pl."amount", pl."status"
       FROM "PaymentLink" pl
       JOIN "Order" o ON o."id" = pl."orderId"
       WHERE o."metadata"->>'cakeOrderId' = $1
         AND o."metadata"->>'appliedTo' = $2
         AND pl."status" = 'pending'
         AND pl."expiresAt" > NOW()
       ORDER BY pl."createdAt" DESC
       LIMIT 1`,
      cakeOrderId,
      input.appliedTo,
    )

    if (existingLinks && existingLinks.length > 0) {
      const existingLink = existingLinks[0]
      const existingAmount = Number(existingLink.amount)

      // Same amount: return existing (idempotent)
      if (Math.abs(existingAmount - input.amount) < 0.01) {
        return ok({
            paymentLinkToken: existingLink.token as string,
            message: 'Existing payment link returned (idempotent)',
            idempotent: true,
          })
      }

      // Different amount: supersede old links (they'll be cancelled by requestCakePaymentViaText)
    }

    // ── Call text-to-pay service ────────────────────────────────────────
    const result = await requestCakePaymentViaText(db as any, {
      cakeOrderId,
      amount: input.amount,
      appliedTo: input.appliedTo,
      employeeId: auth.employee.id,
      locationId,
      customerPhone,
    })

    // ── Return result ───────────────────────────────────────────────────
    return ok({
        paymentLinkToken: result.paymentLinkToken,
        settlementOrderId: result.settlementOrderId,
        message: 'SMS sent to customer',
      })
  } catch (error) {
    console.error('[cake-request-payment] Failed to send text-to-pay:', error)

    // Surface known errors from service layer
    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        return NextResponse.json(
          { code: 'NOT_FOUND', message: error.message },
          { status: 404 },
        )
      }
      if (error.message.includes('does not accept payments')) {
        return NextResponse.json(
          { code: 'INVALID_STATUS', message: error.message },
          { status: 409 },
        )
      }
    }

    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to send payment request' },
      { status: 500 },
    )
  }
})
