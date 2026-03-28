import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { emitToLocation } from '@/lib/socket-server'
import { emitCloudEvent } from '@/lib/cloud-events'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings, getLocationId } from '@/lib/location-cache'
import {
  calculateShiftSummary,
  getShiftTipDistributionSummary,
  closeShift,
} from '@/lib/domain/shift-close'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('shifts')

// GET - Get shift details with sales summary
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = request.nextUrl.searchParams.get('locationId') || await getLocationId()

    const shift = await db.shift.findFirst({
      where: { id, ...(locationId ? { locationId } : {}) },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
        location: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })

    if (!shift) {
      return notFound('Shift not found')
    }

    // Get all orders/payments for this shift period
    const shiftSummary = await calculateShiftSummary(
      shift.locationId,
      shift.employeeId,
      shift.startedAt,
      shift.endedAt || new Date(),
      shift.drawerId || null
    )

    // Include tip distribution summary for closed shifts
    const tipDistributionData = shift.status === 'closed'
      ? await getShiftTipDistributionSummary(shift.id, shift.locationId)
      : null

    return ok({
      shift: {
        id: shift.id,
        employee: {
          id: shift.employee.id,
          name: shift.employee.displayName || `${shift.employee.firstName} ${shift.employee.lastName}`,
        },
        location: shift.location,
        startedAt: shift.startedAt.toISOString(),
        endedAt: shift.endedAt?.toISOString() || null,
        status: shift.status,
        startingCash: Number(shift.startingCash),
        expectedCash: shift.expectedCash ? Number(shift.expectedCash) : null,
        actualCash: shift.actualCash ? Number(shift.actualCash) : null,
        variance: shift.variance ? Number(shift.variance) : null,
        totalSales: shift.totalSales ? Number(shift.totalSales) : null,
        cashSales: shift.cashSales ? Number(shift.cashSales) : null,
        cardSales: shift.cardSales ? Number(shift.cardSales) : null,
        tipsDeclared: shift.tipsDeclared ? Number(shift.tipsDeclared) : null,
        grossTips: shift.grossTips ? Number(shift.grossTips) : null,
        tipOutTotal: shift.tipOutTotal ? Number(shift.tipOutTotal) : null,
        netTips: shift.netTips ? Number(shift.netTips) : null,
        notes: shift.notes,
      },
      summary: shiftSummary,
      tipDistribution: tipDistributionData,
    })
  } catch (error) {
    console.error('Failed to fetch shift:', error)
    return err('Failed to fetch shift', 500)
  }
})

// PUT - Close shift / update shift
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { action, actualCash, tipsDeclared, notes, tipDistribution, employeeId: requestingEmployeeId, cashHandlingMode, forceClose } = body as {
      action: 'close' | 'update'
      actualCash?: number
      tipsDeclared?: number
      notes?: string
      employeeId?: string
      cashHandlingMode?: string
      forceClose?: boolean
      tipDistribution?: {
        grossTips: number
        tipOutTotal: number
        netTips: number
        roleTipOuts: { ruleId: string; toRoleId: string; amount: number }[]
        customShares: { toEmployeeId: string; amount: number }[]
      }
    }

    const shift = await db.shift.findUnique({
      where: { id },
    })

    if (!shift) {
      return notFound('Shift not found')
    }

    if (action === 'close') {
      // Require requesting employee ID for shift close
      if (!requestingEmployeeId) {
        return err('requestingEmployeeId is required to close a shift')
      }

      // Auth: must be the shift owner or have manager.bulk_operations
      if (requestingEmployeeId !== shift.employeeId) {
        const auth = await requireAnyPermission(requestingEmployeeId, shift.locationId, [
          PERMISSIONS.MGR_BULK_OPERATIONS,
        ])
        if (!auth.authorized) {
          return err(auth.error, auth.status)
        }
      }

      if (shift.status === 'closed') {
        return err('Shift is already closed')
      }

      // Check for pending outage queue entries before closing the shift.
      // This is a warning only — it does not block the close.
      try {
        const outageResult = await db.$queryRawUnsafe<[{ cnt: number }]>(
          `SELECT COUNT(*)::int as cnt FROM "OutageQueueEntry" WHERE status IN ('PENDING', 'PROCESSING')`
        )
        const pendingCount = outageResult?.[0]?.cnt ?? 0
        if (pendingCount > 0) {
          console.warn(
            `[ShiftClose] Warning: ${pendingCount} outage queue entries pending sync — shift totals on Neon may be incomplete`
          )
        }
      } catch {
        // OutageQueueEntry table may not exist on all deployments — skip silently
      }

      // For 'none' cash handling mode, actual cash is always 0 (no cash handled)
      const cashMode = cashHandlingMode || 'drawer'
      const effectiveActualCash = cashMode === 'none' ? 0 : actualCash

      if (effectiveActualCash === undefined) {
        return err('Actual cash count is required to close shift')
      }

      // Calculate shift summary (drawer-aware for bartender mode)
      const endTime = new Date()
      const summary = await calculateShiftSummary(
        shift.locationId,
        shift.employeeId,
        shift.startedAt,
        endTime,
        shift.drawerId || null
      )

      // Expected cash = starting cash + cash received - change given + paid in - paid out
      // Note: safe drops are PaidInOut records with type='out' and reason starting with '[SAFE DROP]',
      // so they are already subtracted via summary.paidOut.
      const expectedCash = Number(shift.startingCash) + summary.netCashReceived + summary.paidIn - summary.paidOut
      const variance = effectiveActualCash - expectedCash

      // Guard: large cash variance requires override permission
      // Uses configurable threshold from cashManagement settings (defaults to $5)
      const locSettingsForVariance = parseSettings(await getLocationSettings(shift.locationId))
      const varianceThreshold = locSettingsForVariance.cashManagement?.varianceWarningThreshold ?? 5
      if (Math.abs(variance) > varianceThreshold && requestingEmployeeId) {
        const varAuth = await requirePermission(requestingEmployeeId, shift.locationId, PERMISSIONS.MGR_CASH_VARIANCE_OVERRIDE)
        if (!varAuth.authorized) {
          return NextResponse.json(
            { error: varAuth.error, code: 'VARIANCE_OVERRIDE_REQUIRED', variance },
            { status: varAuth.status }
          )
        }
      }

      // Update shift + process tip distribution atomically
      // Open order check is inside the transaction to prevent TOCTOU race condition
      // Server-side computation of grossTips/tipOutTotal/netTips (BUG #417/#421 fix)
      const closeResult = await db.$transaction(async (tx) => {
        return closeShift(tx, {
          shiftId: id,
          locationId: shift.locationId,
          employeeId: shift.employeeId,
          requestingEmployeeId: requestingEmployeeId!,
          effectiveActualCash,
          rawActualCash: actualCash,
          tipsDeclared,
          notes,
          currentShiftNotes: shift.notes,
          tipDistribution,
          forceClose,
          workingRoleId: shift.workingRoleId,
          summary,
          expectedCash,
          variance,
          endTime,
          shiftStartedAt: shift.startedAt,
        })
      })
      const { updatedShift, transferredOrderIds } = closeResult
      pushUpstream()

      // Fetch tip distribution summary for the response (fire-and-forget safe — not blocking)
      const tipDistributionSummary = await getShiftTipDistributionSummary(id, shift.locationId)

      // Emit ORDER_METADATA_UPDATED for each transferred order (fire-and-forget)
      if (transferredOrderIds.length > 0) {
        void Promise.all(
          transferredOrderIds.map(oid =>
            emitOrderEvent(shift.locationId, oid, 'ORDER_METADATA_UPDATED', {
              employeeId: requestingEmployeeId,
            })
          )
        ).catch(err => log.warn({ err }, 'Background task failed'))
      }

      // Real-time cross-terminal update
      void emitToLocation(shift.locationId, 'shifts:changed', { action: 'closed', shiftId: id, employeeId: shift.employeeId }).catch(err => log.warn({ err }, 'socket emit failed'))
      void emitCloudEvent("shift_closed", {
        employeeId: shift.employeeId,
        shiftId: updatedShift.id,
        totalSales: summary.totalSales,
        cashSales: summary.cashSales,
        cardSales: summary.cardSales,
        totalTips: summary.totalTips,
        variance: Number(updatedShift.variance),
        closedAt: updatedShift.endedAt?.toISOString() || new Date().toISOString(),
      }).catch(err => log.warn({ err }, 'Background task failed'))

      return ok({
        shift: {
          id: updatedShift.id,
          employee: {
            id: updatedShift.employee.id,
            name: updatedShift.employee.displayName || `${updatedShift.employee.firstName} ${updatedShift.employee.lastName}`,
          },
          startedAt: updatedShift.startedAt.toISOString(),
          endedAt: updatedShift.endedAt?.toISOString(),
          status: updatedShift.status,
          startingCash: Number(updatedShift.startingCash),
          expectedCash: Number(updatedShift.expectedCash),
          actualCash: Number(updatedShift.actualCash),
          variance: Number(updatedShift.variance),
          totalSales: Number(updatedShift.totalSales),
          cashSales: Number(updatedShift.cashSales),
          cardSales: Number(updatedShift.cardSales),
          tipsDeclared: Number(updatedShift.tipsDeclared),
          grossTips: Number(updatedShift.grossTips || 0),
          tipOutTotal: Number(updatedShift.tipOutTotal || 0),
          netTips: Number(updatedShift.netTips || 0),
          notes: updatedShift.notes,
        },
        summary,
        tipDistribution: tipDistributionSummary,
        message: variance === 0
          ? 'Shift closed successfully. Drawer is balanced!'
          : variance > 0
            ? `Shift closed. Drawer is OVER by $${variance.toFixed(2)}`
            : `Shift closed. Drawer is SHORT by $${Math.abs(variance).toFixed(2)}`,
      })
    }

    // Simple update (notes, etc.)
    const updatedShift = await db.shift.update({
      where: { id },
      data: {
        ...(notes !== undefined ? { notes } : {}),
      },
    })
    pushUpstream()

    // Real-time cross-terminal update
    void emitToLocation(shift.locationId, 'shifts:changed', { action: 'updated', shiftId: id }).catch(err => log.warn({ err }, 'socket emit failed'))

    return ok({
      shift: updatedShift,
      message: 'Shift updated',
    })
  } catch (error) {
    // Handle structured errors from the transaction
    if (error instanceof Error && error.message.startsWith('OPEN_ORDERS:')) {
      const openOrderCount = parseInt(error.message.split(':')[1], 10)

      // Re-fetch shift for the catch block (shift var is scoped inside try)
      const { id: shiftIdForError } = await params
      const shiftForError = await db.shift.findUnique({
        where: { id: shiftIdForError },
        select: { locationId: true, employeeId: true },
      })

      // Fetch open order details for the handoff UI
      let openOrders: { id: string; orderNumber: number | null; tabName: string | null; status: string; total: number }[] = []
      if (shiftForError) {
        try {
          const orders = await db.order.findMany({
            where: {
              locationId: shiftForError.locationId,
              employeeId: shiftForError.employeeId,
              status: { in: ['open', 'sent', 'in_progress', 'split'] },
              deletedAt: null,
            },
            select: {
              id: true,
              orderNumber: true,
              tabName: true,
              status: true,
              total: true,
            },
            orderBy: { createdAt: 'desc' },
          })
          openOrders = orders.map(o => ({
            id: o.id,
            orderNumber: o.orderNumber,
            tabName: o.tabName,
            status: o.status,
            total: Number(o.total),
          }))
        } catch {
          // If fetching details fails, still return the count-based response
        }
      }

      // Check if employee owns any active tip groups
      let tipGroupsOwned: { id: string; memberCount: number }[] = []
      if (shiftForError) {
        try {
          const groups = await db.tipGroup.findMany({
            where: {
              locationId: shiftForError.locationId,
              ownerId: shiftForError.employeeId,
              status: 'active',
            },
            select: {
              id: true,
            },
          })
          // Count active memberships separately to avoid _count typing issues
          const groupsWithCounts = await Promise.all(
            groups.map(async (g) => {
              const memberCount = await db.tipGroupMembership.count({
                where: { groupId: g.id, status: 'active', deletedAt: null },
              })
              return { id: g.id, memberCount }
            })
          )
          tipGroupsOwned = groupsWithCounts
        } catch {
          // tipGroup table may not exist in all deployments
        }
      }

      return NextResponse.json(
        {
          error: 'Cannot close shift with open orders',
          openOrderCount,
          openOrders,
          canTransfer: true,
          tipGroupsOwned,
          requiresManagerOverride: true,
        },
        { status: 409 }
      )
    }

    // Handle pending $0-tip card payments (SHIFT-1 invariant)
    if (error instanceof Error && error.message.startsWith('PENDING_TIPS:')) {
      const pendingTipCount = parseInt(error.message.split(':')[1], 10)
      return NextResponse.json(
        {
          error: `${pendingTipCount} card payment${pendingTipCount === 1 ? '' : 's'} have $0 tips. Adjust tips before closing shift.`,
          code: 'PENDING_TIPS',
          pendingTipCount,
        },
        { status: 409 }
      )
    }

    console.error('Failed to update shift:', error)
    return err('Failed to update shift', 500)
  }
})

