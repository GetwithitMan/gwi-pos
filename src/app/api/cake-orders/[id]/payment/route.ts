/**
 * POST /api/cake-orders/[id]/payment — Record a payment against a cake order
 *
 * Permission: cake.payment (POS) or cake.payment_external (external)
 *
 * For POS payments: creates a settlement order then records the CakePayment.
 * For external payments: records the CakePayment directly (no settlement order).
 * Auto-advances status from 'approved' to 'deposit_paid' on first deposit.
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { parseSettings, DEFAULT_CAKE_ORDERING } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { dispatchCakeOrderUpdated } from '@/lib/socket-dispatch'
import { recordPaymentSchema } from '@/lib/cake-orders/schemas'
import { createSettlementOrder, recordCakePayment } from '@/lib/cake-orders/cake-payment-service'

export const POST = withVenue(async function POST(
  request: NextRequest,
  context: any,
) {
  try {
    const { id: cakeOrderId } = (await context.params) as { id: string }
    const body = await request.json()

    // ── Validate input ──────────────────────────────────────────────────
    const parsed = recordPaymentSchema.safeParse(body)
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
    // POS payments require cake.payment, external payments require cake.payment_external
    const requiredPermission = input.paymentSource === 'external'
      ? 'cake.payment_external'
      : 'cake.payment'

    const auth = await requirePermission(employeeId, locationId, requiredPermission)
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    // ── Fetch the cake order ────────────────────────────────────────────
    const orderRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "CakeOrder"
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
          message: `Cannot record payment when order is in status '${currentStatus}'. Order must be approved or later.`,
        },
        { status: 409 },
      )
    }

    // ── External payment threshold check ────────────────────────────────
    if (input.paymentSource === 'external') {
      const locSettings = parseSettings(await getLocationSettings(locationId))
      const cakeSettings = locSettings.cakeOrdering
        ? { ...DEFAULT_CAKE_ORDERING, ...locSettings.cakeOrdering }
        : DEFAULT_CAKE_ORDERING

      const threshold = cakeSettings.externalPaymentManagerThreshold

      if (input.amount >= threshold) {
        // Check cumulative daily external payments for this location
        const dailySumRows = await db.$queryRawUnsafe<[{ total: string | number | null }]>(
          `SELECT COALESCE(SUM("amount"), 0) AS total
           FROM "CakePayment" cp
           JOIN "CakeOrder" co ON co."id" = cp."cakeOrderId"
           WHERE co."locationId" = $1
             AND cp."paymentSource" = 'external'
             AND cp."type" = 'payment'
             AND cp."createdAt" >= CURRENT_DATE`,
          locationId,
        )
        const dailyTotal = Number(dailySumRows[0]?.total ?? 0) + input.amount

        // Require owner-level permission for high external payment volume
        if (dailyTotal >= threshold) {
          const ownerAuth = await requirePermission(employeeId, locationId, 'cake.payment_external_override')
          if (!ownerAuth.authorized) {
            return NextResponse.json(
              {
                code: 'EXTERNAL_THRESHOLD_EXCEEDED',
                message: `External payment of $${input.amount.toFixed(2)} exceeds the daily threshold of $${threshold.toFixed(2)}. Owner approval required.`,
              },
              { status: 403 },
            )
          }
        }
      }
    }

    // ── Validate method for external payments ───────────────────────────
    if (input.paymentSource === 'external' && !input.method) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: 'Payment method is required for external payments' },
        { status: 400 },
      )
    }

    // ── Validate notes for external refunds ─────────────────────────────
    if (input.type === 'refund' && input.paymentSource === 'external' && !input.notes) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: 'Notes are required for external refunds' },
        { status: 400 },
      )
    }

    // ── Create settlement order for POS payments ────────────────────────
    let posOrderId: string | null = null

    if (input.paymentSource === 'pos' && input.type === 'payment') {
      const orderNumber = Number(cakeOrder.orderNumber ?? 0)
      const customerId = cakeOrder.customerId as string | null

      if (!customerId) {
        return NextResponse.json(
          { code: 'NO_CUSTOMER', message: 'CakeOrder has no customerId. Cannot create settlement order.' },
          { status: 400 },
        )
      }

      const settlement = await createSettlementOrder(db as any, {
        cakeOrderId,
        cakeOrderNumber: orderNumber,
        customerId,
        locationId,
        employeeId: auth.employee.id,
        amount: input.amount,
        appliedTo: input.appliedTo,
      })

      posOrderId = settlement.orderId
    }

    // ── Record the CakePayment ──────────────────────────────────────────
    const { cakePaymentId } = await recordCakePayment(db as any, {
      cakeOrderId,
      type: input.type,
      appliedTo: input.appliedTo,
      paymentSource: input.paymentSource,
      amount: input.amount,
      method: input.method || 'card',
      posOrderId,
      posPaymentId: null, // POS payment ID is linked later via settlement completion handler
      reversesCakePaymentId: input.reversesCakePaymentId || null,
      reference: input.reference || null,
      notes: input.notes || null,
      processedBy: auth.employee.id,
    })

    // ── Auto-advance status: approved -> deposit_paid on first deposit ──
    if (
      currentStatus === 'approved' &&
      input.type === 'payment' &&
      input.appliedTo === 'deposit'
    ) {
      await db.$executeRawUnsafe(
        `UPDATE "CakeOrder"
         SET "status" = 'deposit_paid',
             "depositPaidAt" = NOW(),
             "updatedAt" = NOW()
         WHERE "id" = $1 AND "status" = 'approved'`,
        cakeOrderId,
      )

      // Additional change log for status transition
      const statusChangeId = crypto.randomUUID()
      await db.$executeRawUnsafe(
        `INSERT INTO "CakeOrderChange" (
          "id", "cakeOrderId", "changeType", "changedBy", "source",
          "details", "createdAt"
        ) VALUES (
          $1, $2, 'status_change', $3, 'system',
          $4::jsonb, NOW()
        )`,
        statusChangeId,
        cakeOrderId,
        auth.employee.id,
        JSON.stringify({
          previousStatus: 'approved',
          newStatus: 'deposit_paid',
          trigger: 'first_deposit_payment',
          cakePaymentId,
        }),
      )
    }

    // ── Socket event ────────────────────────────────────────────────────
    // Determine new status: if auto-advanced to deposit_paid, use that; otherwise keep current
    const emitStatus = (currentStatus === 'approved' && input.type === 'payment' && input.appliedTo === 'deposit')
      ? 'deposit_paid'
      : currentStatus
    void dispatchCakeOrderUpdated(locationId, {
      cakeOrderId,
      status: emitStatus,
      changeType: 'payment_recorded',
    }).catch(err => console.error('[cake-payment] Socket dispatch failed:', err))

    // ── Return payment record ───────────────────────────────────────────
    return NextResponse.json({
      data: {
        cakePaymentId,
        cakeOrderId,
        type: input.type,
        appliedTo: input.appliedTo,
        paymentSource: input.paymentSource,
        amount: input.amount,
        method: input.method || 'card',
        posOrderId,
        reference: input.reference || null,
        notes: input.notes || null,
        processedBy: auth.employee.id,
      },
    })
  } catch (error) {
    console.error('[cake-payment] Failed to record payment:', error)

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
      { code: 'INTERNAL_ERROR', message: 'Failed to record payment' },
      { status: 500 },
    )
  }
})
