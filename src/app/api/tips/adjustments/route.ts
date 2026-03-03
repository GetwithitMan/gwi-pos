/**
 * Tip Adjustments API (Skill 256)
 *
 * GET  - List adjustment history for a location (audit trail)
 * POST - Create a tip adjustment (manual or with recalculation)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import {
  performTipAdjustment,
  recalculateGroupAllocations,
  recalculateOrderAllocations,
  getAdjustmentHistory,
} from '@/lib/domain/tips/tip-recalculation'
import type { AdjustmentType } from '@/lib/domain/tips/tip-recalculation'
import { withVenue } from '@/lib/with-venue'

// ─── Valid adjustment types ──────────────────────────────────────────────────

const VALID_ADJUSTMENT_TYPES: AdjustmentType[] = [
  'group_membership',
  'ownership_split',
  'clock_fix',
  'manual_override',
  'tip_amount',
]

// ─── GET: List adjustment history ────────────────────────────────────────────

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const adjustmentType = searchParams.get('adjustmentType')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const limitParam = searchParams.get('limit')
    const offsetParam = searchParams.get('offset')

    // ── Validate required fields ──────────────────────────────────────────

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // Validate adjustmentType if provided
    if (adjustmentType && !VALID_ADJUSTMENT_TYPES.includes(adjustmentType as AdjustmentType)) {
      return NextResponse.json(
        { error: `Invalid adjustmentType. Must be one of: ${VALID_ADJUSTMENT_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    // ── Auth check ────────────────────────────────────────────────────────
    // Requires TIPS_PERFORM_ADJUSTMENTS or TIPS_VIEW_LEDGER permission
    const requestingEmployeeId = request.headers.get('x-employee-id')

    const auth = await requireAnyPermission(
      requestingEmployeeId,
      locationId,
      [PERMISSIONS.TIPS_PERFORM_ADJUSTMENTS, PERMISSIONS.TIPS_VIEW_LEDGER]
    )
    if (!auth.authorized) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      )
    }

    // ── Build filters ─────────────────────────────────────────────────────
    const limit = limitParam ? Math.max(1, Math.min(500, parseInt(limitParam, 10) || 50)) : 50
    const offset = offsetParam ? Math.max(0, parseInt(offsetParam, 10) || 0) : 0

    const historyParams: {
      locationId: string
      limit: number
      offset: number
      adjustmentType?: AdjustmentType
      dateFrom?: Date
      dateTo?: Date
    } = {
      locationId,
      limit,
      offset,
    }

    if (adjustmentType) {
      historyParams.adjustmentType = adjustmentType as AdjustmentType
    }

    if (dateFrom) {
      historyParams.dateFrom = new Date(dateFrom)
    }

    if (dateTo) {
      const dateToEnd = new Date(dateTo)
      dateToEnd.setHours(23, 59, 59, 999)
      historyParams.dateTo = dateToEnd
    }

    // ── Query adjustments ─────────────────────────────────────────────────
    const { adjustments, total } = await getAdjustmentHistory(historyParams)

    return NextResponse.json({
      adjustments: adjustments.map(adj => ({
        id: adj.id,
        createdById: adj.createdById,
        reason: adj.reason,
        adjustmentType: adj.adjustmentType,
        contextJson: adj.contextJson,
        autoRecalcRan: adj.autoRecalcRan,
        createdAt: adj.createdAt.toISOString(),
      })),
      total,
      limit,
      offset,
    })
  } catch (error) {
    console.error('Failed to get tip adjustments:', error)
    return NextResponse.json(
      { error: 'Failed to get tip adjustments' },
      { status: 500 }
    )
  }
})

// ─── POST: Create a tip adjustment ──────────────────────────────────────────

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, adjustmentType, reason, context, employeeDeltas, recalculate,
            orderId, paymentId, tipAmountDollars } = body

    // ── Validate required fields ──────────────────────────────────────────

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    if (!adjustmentType) {
      return NextResponse.json(
        { error: 'adjustmentType is required' },
        { status: 400 }
      )
    }

    if (!VALID_ADJUSTMENT_TYPES.includes(adjustmentType as AdjustmentType)) {
      return NextResponse.json(
        { error: `Invalid adjustmentType. Must be one of: ${VALID_ADJUSTMENT_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    const requestingEmployeeId = request.headers.get('x-employee-id')

    // ── Self-service tip_amount: employee adjusting their own order's tip ──
    if (adjustmentType === 'tip_amount') {
      if (!orderId || !paymentId || tipAmountDollars === undefined) {
        return NextResponse.json(
          { error: 'orderId, paymentId, and tipAmountDollars are required for tip_amount adjustments' },
          { status: 400 }
        )
      }

      // Look up the order to check ownership
      const order = await db.order.findUnique({
        where: { id: orderId },
        select: { employeeId: true },
      })

      if (!order) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      }

      const isSelfService = order.employeeId === requestingEmployeeId

      if (!isSelfService) {
        // Not the owner — require TIPS_PERFORM_ADJUSTMENTS
        const auth = await requireAnyPermission(
          requestingEmployeeId,
          locationId,
          [PERMISSIONS.TIPS_PERFORM_ADJUSTMENTS]
        )
        if (!auth.authorized) {
          return NextResponse.json(
            { error: auth.error },
            { status: auth.status }
          )
        }
      }

      // Convert dollars to cents
      const tipAmountCents = Math.round((tipAmountDollars as number) * 100)

      const result = await performTipAdjustment({
        locationId,
        managerId: requestingEmployeeId!,
        adjustmentType: 'tip_amount',
        reason: reason || 'Tip amount adjustment',
        context: context || {
          before: { orderId, paymentId },
          after: { orderId, paymentId, tipAmountCents },
        },
        employeeDeltas,
        paymentUpdate: { paymentId, tipAmountCents },
      })

      return NextResponse.json({ adjustment: result })
    }

    // ── Standard adjustments: validate remaining required fields ──────────

    if (!reason) {
      return NextResponse.json(
        { error: 'reason is required' },
        { status: 400 }
      )
    }

    if (!context || !context.before || !context.after) {
      return NextResponse.json(
        { error: 'context with before and after is required' },
        { status: 400 }
      )
    }

    // ── Auth check ────────────────────────────────────────────────────────
    // Requires TIPS_PERFORM_ADJUSTMENTS permission

    const auth = await requireAnyPermission(
      requestingEmployeeId,
      locationId,
      [PERMISSIONS.TIPS_PERFORM_ADJUSTMENTS]
    )
    if (!auth.authorized) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      )
    }

    const managerId = auth.employee.id

    // ── Handle recalculation or manual adjustment ─────────────────────────

    if (recalculate) {
      // Recalculation mode
      if (recalculate.type === 'group') {
        if (!recalculate.groupId) {
          return NextResponse.json(
            { error: 'recalculate.groupId is required for group recalculation' },
            { status: 400 }
          )
        }

        const result = await recalculateGroupAllocations({
          locationId,
          managerId,
          groupId: recalculate.groupId,
          segmentId: recalculate.segmentId,
          reason,
        })

        return NextResponse.json({ adjustment: result })

      } else if (recalculate.type === 'order') {
        if (!recalculate.orderId) {
          return NextResponse.json(
            { error: 'recalculate.orderId is required for order recalculation' },
            { status: 400 }
          )
        }

        const result = await recalculateOrderAllocations({
          locationId,
          managerId,
          orderId: recalculate.orderId,
          reason,
        })

        return NextResponse.json({ adjustment: result })

      } else {
        return NextResponse.json(
          { error: 'recalculate.type must be "group" or "order"' },
          { status: 400 }
        )
      }
    }

    // Manual adjustment mode
    const result = await performTipAdjustment({
      locationId,
      managerId,
      adjustmentType: adjustmentType as AdjustmentType,
      reason,
      context,
      employeeDeltas,
    })

    return NextResponse.json({ adjustment: result })

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    // Handle known domain errors
    if (message === 'TIP_GROUP_NOT_FOUND') {
      return NextResponse.json(
        { error: 'Tip group not found' },
        { status: 404 }
      )
    }

    if (message === 'NO_ACTIVE_OWNERSHIP') {
      return NextResponse.json(
        { error: 'No active ownership found for this order' },
        { status: 404 }
      )
    }

    console.error('Failed to create tip adjustment:', error)
    return NextResponse.json(
      { error: 'Failed to create tip adjustment' },
      { status: 500 }
    )
  }
})
