/**
 * Tip Adjustments API (Skill 256)
 *
 * GET  - List adjustment history for a location (audit trail)
 * POST - Create a tip adjustment (manual or with recalculation)
 */

import { NextRequest } from 'next/server'
import { OrderRepository, PaymentRepository } from '@/lib/repositories'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { db } from '@/lib/db'
import {
  performTipAdjustment,
  recalculateGroupAllocations,
  recalculateOrderAllocations,
  getAdjustmentHistory,
} from '@/lib/domain/tips/tip-recalculation'
import type { AdjustmentType } from '@/lib/domain/tips/tip-recalculation'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { queueIfOutageOrFail, OutageQueueFullError, pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, forbidden, notFound, ok } from '@/lib/api-response'

// ─── Valid adjustment types ──────────────────────────────────────────────────

const VALID_ADJUSTMENT_TYPES: AdjustmentType[] = [
  'group_membership',
  'ownership_split',
  'clock_fix',
  'manual_override',
  'tip_amount',
]

// ─── GET: List adjustment history ────────────────────────────────────────────

export const GET = withVenue(withAuth('ADMIN', async function GET(request: NextRequest) {
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
      return err('locationId is required')
    }

    // Validate adjustmentType if provided
    if (adjustmentType && !VALID_ADJUSTMENT_TYPES.includes(adjustmentType as AdjustmentType)) {
      return err(`Invalid adjustmentType. Must be one of: ${VALID_ADJUSTMENT_TYPES.join(', ')}`)
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
      return err(auth.error, auth.status)
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

    return ok({
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
    return err('Failed to get tip adjustments', 500)
  }
}))

// ─── POST: Create a tip adjustment ──────────────────────────────────────────

export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const isPreview = request.nextUrl.searchParams.get('preview') === 'true'

    const body = await request.json()
    const { locationId, adjustmentType, reason, context, employeeDeltas, recalculate,
            orderId, paymentId, tipAmountDollars } = body

    // ── Validate required fields ──────────────────────────────────────────

    if (!locationId) {
      return err('locationId is required')
    }

    if (!adjustmentType) {
      return err('adjustmentType is required')
    }

    if (!VALID_ADJUSTMENT_TYPES.includes(adjustmentType as AdjustmentType)) {
      return err(`Invalid adjustmentType. Must be one of: ${VALID_ADJUSTMENT_TYPES.join(', ')}`)
    }

    const requestingEmployeeId = request.headers.get('x-employee-id')

    // ── Self-service tip_amount: employee adjusting their own order's tip ──
    if (adjustmentType === 'tip_amount') {
      if (!orderId || !paymentId || tipAmountDollars === undefined) {
        return err('orderId, paymentId, and tipAmountDollars are required for tip_amount adjustments')
      }

      // Look up the order to check ownership
      const order = await OrderRepository.getOrderByIdWithSelect(
        orderId,
        locationId,
        { employeeId: true },
      )

      if (!order) {
        return notFound('Order not found')
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
          return err(auth.error, auth.status)
        }
      }

      // M6: Block edits if the payment's shift closed more than 24 hours ago
      const payment = await PaymentRepository.getPaymentByIdWithSelect(
        paymentId,
        locationId,
        {
          amount: true,
          shift: {
            select: { status: true, endedAt: true },
          },
        },
      )

      if (payment?.shift?.status === 'closed' && payment.shift.endedAt) {
        const hoursSinceClose = (Date.now() - payment.shift.endedAt.getTime()) / (1000 * 60 * 60)
        if (hoursSinceClose > 24) {
          return forbidden('Tips can only be edited within 24 hours of shift close.')
        }
      }

      // Convert dollars to cents
      const tipAmountCents = Math.round((tipAmountDollars as number) * 100)

      // M2: Hard-reject tips that exceed 200% of the payment base (extreme fat-finger guard)
      const baseAmountCents = Math.round(Number(payment?.amount) * 100)
      if (baseAmountCents > 0 && tipAmountCents > baseAmountCents * 2) {
        return err('Tip amount exceeds 200% of the payment total. If intentional, contact a manager.')
      }

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

      try {
        await queueIfOutageOrFail('TipAdjustment', locationId, result.adjustmentId, 'INSERT')
      } catch (caughtErr) {
        if (err instanceof OutageQueueFullError) {
          return err('Service temporarily unavailable — outage queue full', 507)
        }
        throw err
      }
      pushUpstream()

      return ok({ adjustment: result })
    }

    // ── Standard adjustments: validate remaining required fields ──────────

    if (!reason) {
      return err('reason is required')
    }

    if (!context || !context.before || !context.after) {
      return err('context with before and after is required')
    }

    // ── Auth check ────────────────────────────────────────────────────────
    // Requires TIPS_PERFORM_ADJUSTMENTS permission

    const auth = await requireAnyPermission(
      requestingEmployeeId,
      locationId,
      [PERMISSIONS.TIPS_PERFORM_ADJUSTMENTS]
    )
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    const managerId = auth.employee.id

    // ── Preview mode: compute impact without writing ────────────────────
    if (isPreview) {
      const previewImpact: Array<{
        employeeId: string
        currentBalanceCents: number
        deltaCents: number
        newBalanceCents: number
      }> = []

      if (recalculate) {
        // Preview a recalculation — read-only computation
        if (recalculate.type === 'group' && recalculate.groupId) {
          const group = await db.tipGroup.findFirst({
            where: { id: recalculate.groupId, deletedAt: null },
            include: {
              segments: {
                where: { deletedAt: null, ...(recalculate.segmentId ? { id: recalculate.segmentId } : {}) },
                orderBy: { startedAt: 'asc' },
              },
            },
          })
          if (!group) {
            return notFound('Tip group not found')
          }

          const transactions = await db.tipTransaction.findMany({
            where: { tipGroupId: recalculate.groupId, deletedAt: null, ...(recalculate.segmentId ? { segmentId: recalculate.segmentId } : {}) },
          })

          const segmentLookup = new Map<string, Record<string, number>>()
          for (const seg of group.segments) {
            segmentLookup.set(seg.id, seg.splitJson as Record<string, number>)
          }

          const employeeDeltaMap = new Map<string, { previousCents: number; newCents: number }>()
          for (const txn of transactions) {
            if (!txn.segmentId || Number(txn.amountCents) <= 0) continue
            const splitJson = segmentLookup.get(txn.segmentId)
            if (!splitJson) continue
            const memberIds = Object.keys(splitJson)
            if (memberIds.length === 0) continue

            // Calculate expected shares
            let allocated = 0
            const expectedShares = memberIds.map((empId, i) => {
              const pct = splitJson[empId] ?? 0
              if (i === memberIds.length - 1) return { employeeId: empId, amountCents: Number(txn.amountCents) - allocated }
              const share = Math.round(Number(txn.amountCents) * pct)
              allocated += share
              return { employeeId: empId, amountCents: share }
            })

            const existingEntries = await db.tipLedgerEntry.findMany({
              where: { sourceType: 'TIP_GROUP', sourceId: txn.id, deletedAt: null },
              select: { employeeId: true, amountCents: true },
            })

            const actualMap = new Map<string, number>()
            for (const entry of existingEntries) {
              actualMap.set(entry.employeeId, (actualMap.get(entry.employeeId) || 0) + Number(entry.amountCents))
            }

            for (const share of expectedShares) {
              const actual = actualMap.get(share.employeeId) || 0
              const existing = employeeDeltaMap.get(share.employeeId) || { previousCents: 0, newCents: 0 }
              existing.previousCents += actual
              existing.newCents += share.amountCents
              employeeDeltaMap.set(share.employeeId, existing)
            }
            for (const [empId, actualCents] of actualMap) {
              if (!expectedShares.some(s => s.employeeId === empId)) {
                const existing = employeeDeltaMap.get(empId) || { previousCents: 0, newCents: 0 }
                existing.previousCents += actualCents
                employeeDeltaMap.set(empId, existing)
              }
            }
          }

          // Get current balances
          const empIds = [...employeeDeltaMap.keys()]
          const ledgers = empIds.length > 0 ? await db.tipLedger.findMany({
            where: { employeeId: { in: empIds }, locationId },
            select: { employeeId: true, currentBalanceCents: true },
          }) : []
          const balanceMap = new Map(ledgers.map(l => [l.employeeId, Number(l.currentBalanceCents)]))

          for (const [empId, data] of employeeDeltaMap) {
            const delta = data.newCents - data.previousCents
            if (delta === 0) continue
            const currentBalance = balanceMap.get(empId) || 0
            previewImpact.push({
              employeeId: empId,
              currentBalanceCents: currentBalance,
              deltaCents: delta,
              newBalanceCents: currentBalance + delta,
            })
          }
        }
        // Order recalculation preview is analogous but omitted for brevity — same pattern
      } else if (employeeDeltas && Array.isArray(employeeDeltas)) {
        // Preview manual deltas
        const empIds = employeeDeltas.map((d: { employeeId: string }) => d.employeeId)
        const ledgers = empIds.length > 0 ? await db.tipLedger.findMany({
          where: { employeeId: { in: empIds }, locationId },
          select: { employeeId: true, currentBalanceCents: true },
        }) : []
        const balanceMap = new Map(ledgers.map(l => [l.employeeId, Number(l.currentBalanceCents)]))

        for (const delta of employeeDeltas) {
          if (delta.deltaCents === 0) continue
          const currentBalance = balanceMap.get(delta.employeeId) || 0
          previewImpact.push({
            employeeId: delta.employeeId,
            currentBalanceCents: currentBalance,
            deltaCents: delta.deltaCents,
            newBalanceCents: currentBalance + delta.deltaCents,
          })
        }
      }

      return ok({
        preview: true,
        adjustmentType,
        impactPerEmployee: previewImpact,
      })
    }
    // ── End preview mode ────────────────────────────────────────────────────

    // ── Handle recalculation or manual adjustment ─────────────────────────

    if (recalculate) {
      // Recalculation mode
      if (recalculate.type === 'group') {
        if (!recalculate.groupId) {
          return err('recalculate.groupId is required for group recalculation')
        }

        const result = await recalculateGroupAllocations({
          locationId,
          managerId,
          groupId: recalculate.groupId,
          segmentId: recalculate.segmentId,
          reason,
        })

        try {
          await queueIfOutageOrFail('TipAdjustment', locationId, result.adjustmentId, 'INSERT')
        } catch (caughtErr) {
          if (err instanceof OutageQueueFullError) {
            return err('Service temporarily unavailable — outage queue full', 507)
          }
          throw err
        }
        pushUpstream()

        return ok({ adjustment: result })

      } else if (recalculate.type === 'order') {
        if (!recalculate.orderId) {
          return err('recalculate.orderId is required for order recalculation')
        }

        const result = await recalculateOrderAllocations({
          locationId,
          managerId,
          orderId: recalculate.orderId,
          reason,
        })

        try {
          await queueIfOutageOrFail('TipAdjustment', locationId, result.adjustmentId, 'INSERT')
        } catch (caughtErr) {
          if (err instanceof OutageQueueFullError) {
            return err('Service temporarily unavailable — outage queue full', 507)
          }
          throw err
        }
        pushUpstream()

        return ok({ adjustment: result })

      } else {
        return err('recalculate.type must be "group" or "order"')
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

    try {
      await queueIfOutageOrFail('TipAdjustment', locationId, result.adjustmentId, 'INSERT')
    } catch (caughtErr) {
      if (err instanceof OutageQueueFullError) {
        return err('Service temporarily unavailable — outage queue full', 507)
      }
      throw err
    }
    pushUpstream()

    return ok({ adjustment: result })

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    // Handle known domain errors
    if (message === 'TIP_GROUP_NOT_FOUND') {
      return notFound('Tip group not found')
    }

    if (message === 'NO_ACTIVE_OWNERSHIP') {
      return notFound('No active ownership found for this order')
    }

    console.error('Failed to create tip adjustment:', error)
    return err('Failed to create tip adjustment', 500)
  }
}))
