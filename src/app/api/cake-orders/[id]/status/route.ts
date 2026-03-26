/**
 * PATCH /api/cake-orders/[id]/status — Transition a cake order to a new status
 *
 * Uses the cake state machine for validation. Permission is resolved dynamically
 * from the (current, target) pair. Optimistic concurrency via expectedUpdatedAt.
 *
 * Inserts CakeOrderChange audit trail entry. Emits socket event.
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { dispatchCakeOrderUpdated } from '@/lib/socket-dispatch'
import { transitionStatusSchema } from '@/lib/cake-orders/schemas'
import {
  validateCakeTransition,
  getRequiredPermission,
  getTimestampField,
  type CakeOrderStatus,
} from '@/lib/cake-orders/cake-state-machine'
import { parseSettings, DEFAULT_CAKE_ORDERING } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

export const PATCH = withVenue(async function PATCH(
  request: NextRequest,
  context: any,
) {
  try {
    const { id: cakeOrderId } = (await context.params) as { id: string }
    const body = await request.json()

    // ── Validate input ─────────────────────────────────────────────────
    const parsed = transitionStatusSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      )
    }
    const { status: targetStatus, reason, expectedUpdatedAt } = parsed.data

    // ── Resolve actor ──────────────────────────────────────────────────
    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || (body.employeeId as string | undefined)
    const locationId = actor.locationId || (body.locationId as string | undefined)

    if (!locationId) {
      return NextResponse.json(
        { code: 'MISSING_LOCATION', message: 'locationId is required' },
        { status: 400 },
      )
    }

    // ── Fetch the cake order ───────────────────────────────────────────
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
    const currentStatus = cakeOrder.status as CakeOrderStatus

    // ── Optimistic concurrency check ───────────────────────────────────
    if (expectedUpdatedAt) {
      const orderUpdatedAt = new Date(cakeOrder.updatedAt as string).toISOString()
      const expectedIso = new Date(expectedUpdatedAt).toISOString()
      if (orderUpdatedAt !== expectedIso) {
        return NextResponse.json(
          {
            code: 'STALE_DATA',
            message: 'Order was modified by another user. Please reload and try again.',
            serverUpdatedAt: orderUpdatedAt,
          },
          { status: 409 },
        )
      }
    }

    // ── Resolve required permission dynamically ────────────────────────
    let requiredPermission: string
    try {
      requiredPermission = getRequiredPermission(currentStatus, targetStatus as CakeOrderStatus)
    } catch {
      return NextResponse.json(
        {
          code: 'INVALID_TRANSITION',
          message: `No valid transition from "${currentStatus}" to "${targetStatus}".`,
        },
        { status: 400 },
      )
    }

    // ── Permission check ───────────────────────────────────────────────
    const auth = await requirePermission(employeeId, locationId, requiredPermission)
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    // ── Build transition context ───────────────────────────────────────
    // Fetch deposit/balance payment info
    const paymentRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "type", "appliedTo" FROM "CakePayment"
       WHERE "cakeOrderId" = $1`,
      cakeOrderId,
    )

    const hasDepositPayment = paymentRows.some(
      (p) => p.type === 'payment' && p.appliedTo === 'deposit',
    )
    const hasBalancePayments = paymentRows.some(
      (p) => p.type === 'payment' && p.appliedTo === 'balance',
    )

    // Fetch latest approved quote if needed
    const quoteRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "status", "version", "updatedAt" FROM "CakeQuote"
       WHERE "cakeOrderId" = $1 AND "deletedAt" IS NULL
       ORDER BY "version" DESC
       LIMIT 1`,
      cakeOrderId,
    )
    const latestQuote = quoteRows.length > 0
      ? {
          status: quoteRows[0].status as string,
          version: Number(quoteRows[0].version),
          updatedAt: new Date(quoteRows[0].updatedAt as string),
        }
      : null

    // Load cake ordering settings for requireDeposit
    const locSettings = parseSettings(await getLocationSettings(locationId))
    const cakeSettings = locSettings.cakeOrdering
      ? { ...DEFAULT_CAKE_ORDERING, ...locSettings.cakeOrdering }
      : DEFAULT_CAKE_ORDERING

    // ── Run state machine validation ───────────────────────────────────
    const transitionResult = validateCakeTransition(
      currentStatus,
      targetStatus as CakeOrderStatus,
      {
        order: {
          status: currentStatus,
          balanceDue: Number(cakeOrder.balanceDue ?? 0),
          depositPaid: Number(cakeOrder.depositPaid ?? 0),
          depositRequired: Number(cakeOrder.depositRequired ?? 0),
          customerId: cakeOrder.customerId as string | null,
        },
        quote: latestQuote,
        hasDepositPayment,
        hasBalancePayments,
        requireDeposit: cakeSettings.requireDeposit,
        reason: reason ?? undefined,
        permission: requiredPermission,
      },
    )

    if (!transitionResult.valid) {
      return NextResponse.json(
        {
          code: transitionResult.code ?? 'TRANSITION_FAILED',
          message: transitionResult.error,
        },
        { status: 409 },
      )
    }

    // ── Build UPDATE SET clause ────────────────────────────────────────
    const setClauses: string[] = [
      `"status" = $2`,
      `"updatedAt" = NOW()`,
    ]
    const updateParams: unknown[] = [cakeOrderId, targetStatus]
    let paramIdx = 3

    // Set timestamp field for this status (e.g., submittedAt, cancelledAt)
    const timestampField = getTimestampField(targetStatus as CakeOrderStatus)
    if (timestampField) {
      setClauses.push(`"${timestampField}" = NOW()`)
    }

    // Store cancellation reason
    if (targetStatus === 'cancelled' && reason) {
      setClauses.push(`"cancellationReason" = $${paramIdx}`)
      updateParams.push(reason)
      paramIdx++
    }

    // ── UPDATE CakeOrder ───────────────────────────────────────────────
    await db.$executeRawUnsafe(
      `UPDATE "CakeOrder"
       SET ${setClauses.join(', ')}
       WHERE "id" = $1 AND "deletedAt" IS NULL`,
      ...updateParams,
    )

    // ── INSERT CakeOrderChange (audit trail) ───────────────────────────
    const changeId = crypto.randomUUID()
    await db.$executeRawUnsafe(
      `INSERT INTO "CakeOrderChange" (
        "id", "cakeOrderId", "changeType", "changedBy", "source",
        "details", "createdAt"
      ) VALUES (
        $1, $2, 'status_change', $3, 'admin',
        $4::jsonb, NOW()
      )`,
      changeId,
      cakeOrderId,
      auth.employee.id,
      JSON.stringify({
        previousStatus: currentStatus,
        newStatus: targetStatus,
        reason: reason || null,
      }),
    )

    pushUpstream()

    // ── Socket event ───────────────────────────────────────────────────
    void dispatchCakeOrderUpdated(locationId, {
      cakeOrderId,
      status: targetStatus as string,
      changeType: 'status_change',
    }).catch(err => console.error('[cake-status] Socket dispatch failed:', err))

    // ── Ingredient stock check (advisory, non-blocking) ─────────────
    let ingredientWarnings: any[] = []
    if (targetStatus === 'in_production') {
      try {
        const { checkIngredientStock } = await import('@/lib/cake-orders/ingredient-check')
        ingredientWarnings = await checkIngredientStock(db, cakeOrderId)
      } catch (err) {
        console.error('[cake-status] Ingredient check failed:', err)
      }
    }

    // ── Fetch updated order for response ───────────────────────────────
    const updatedRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT co.*,
              c."firstName" AS "customerFirstName",
              c."lastName" AS "customerLastName",
              c."phone" AS "customerPhone",
              c."email" AS "customerEmail"
       FROM "CakeOrder" co
       LEFT JOIN "Customer" c ON c."id" = co."customerId"
       WHERE co."id" = $1`,
      cakeOrderId,
    )

    return NextResponse.json({
      data: updatedRows[0],
      ...(ingredientWarnings.length > 0 ? { ingredientWarnings } : {}),
    })
  } catch (error) {
    console.error('[cake-status] Failed to transition status:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to transition cake order status' },
      { status: 500 },
    )
  }
})
