import { NextRequest, NextResponse } from 'next/server'
import { db, adminDb } from '@/lib/db'
import { requirePermission, requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { emitToLocation } from '@/lib/socket-server'
import { emitCloudEvent } from '@/lib/cloud-events'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import {
  calculateShiftSummary,
  getShiftTipDistributionSummary,
  closeShift,
} from '@/lib/domain/shift-close'

// GET - Get shift details with sales summary
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const shift = await db.shift.findUnique({
      where: { id },
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
      return NextResponse.json(
        { error: 'Shift not found' },
        { status: 404 }
      )
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

    return NextResponse.json({ data: {
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
    } })
  } catch (error) {
    console.error('Failed to fetch shift:', error)
    return NextResponse.json(
      { error: 'Failed to fetch shift' },
      { status: 500 }
    )
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
      return NextResponse.json(
        { error: 'Shift not found' },
        { status: 404 }
      )
    }

    if (action === 'close') {
      // Require requesting employee ID for shift close
      if (!requestingEmployeeId) {
        return NextResponse.json(
          { error: 'requestingEmployeeId is required to close a shift' },
          { status: 400 }
        )
      }

      // Auth: must be the shift owner or have manager.bulk_operations
      if (requestingEmployeeId !== shift.employeeId) {
        const auth = await requireAnyPermission(requestingEmployeeId, shift.locationId, [
          PERMISSIONS.MGR_BULK_OPERATIONS,
        ])
        if (!auth.authorized) {
          return NextResponse.json({ error: auth.error }, { status: auth.status })
        }
      }

      if (shift.status === 'closed') {
        return NextResponse.json(
          { error: 'Shift is already closed' },
          { status: 400 }
        )
      }

      // Check for pending outage queue entries before closing the shift.
      // This is a warning only — it does not block the close.
      try {
        const outageResult = await db.$queryRawUnsafe<[{ cnt: number }]>(
          `SELECT COUNT(*)::int as cnt FROM "OutageQueueEntry" WHERE status IN ('pending', 'processing')`
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
        return NextResponse.json(
          { error: 'Actual cash count is required to close shift' },
          { status: 400 }
        )
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
        })
      })
      const { updatedShift, transferredOrderIds } = closeResult

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
        ).catch(console.error)
      }

      // Real-time cross-terminal update
      void emitToLocation(shift.locationId, 'shifts:changed', { action: 'closed', shiftId: id, employeeId: shift.employeeId }).catch(() => {})

      // Emit cloud event for shift closed (fire-and-forget)
      void emitCloudEvent("shift_closed", {
        employeeId: shift.employeeId,
        shiftId: updatedShift.id,
        totalSales: summary.totalSales,
        cashSales: summary.cashSales,
        cardSales: summary.cardSales,
        totalTips: summary.totalTips,
        variance: Number(updatedShift.variance),
        closedAt: updatedShift.endedAt?.toISOString() || new Date().toISOString(),
      }).catch(console.error)

      return NextResponse.json({ data: {
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
      } })
    }

    // Simple update (notes, etc.)
    const updatedShift = await db.shift.update({
      where: { id },
      data: {
        ...(notes !== undefined ? { notes } : {}),
      },
    })

    // Real-time cross-terminal update
    void emitToLocation(shift.locationId, 'shifts:changed', { action: 'updated', shiftId: id }).catch(() => {})

    return NextResponse.json({ data: {
      shift: updatedShift,
      message: 'Shift updated',
    } })
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
          const orders = await adminDb.order.findMany({
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
    console.error('Failed to update shift:', error)
    return NextResponse.json(
      { error: 'Failed to update shift' },
      { status: 500 }
    )
  }
})

