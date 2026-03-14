/**
 * Close Shift Orchestration
 *
 * Core business logic for closing a shift. Runs inside a transaction
 * owned by the route. Framework-agnostic — no NextRequest/NextResponse.
 */

import type { TxClient, ShiftCloseInput, ShiftCloseResult } from './types'
import { processTipDistribution, autoProcessTipDistribution } from './tip-distribution'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'

export async function closeShift(
  tx: TxClient,
  input: ShiftCloseInput
): Promise<ShiftCloseResult> {
  const {
    shiftId,
    locationId,
    employeeId,
    requestingEmployeeId,
    effectiveActualCash,
    rawActualCash,
    tipsDeclared,
    notes,
    currentShiftNotes,
    tipDistribution,
    forceClose,
    workingRoleId,
    summary,
    expectedCash,
    variance,
    endTime,
  } = input

  let transferredOrderIds: string[] = []

  // Check if employee has open orders (requireCloseTabsBeforeShift setting)
  const locationSettings = await getLocationSettings(locationId)
  const locSettings = parseSettings(locationSettings)
  const requireClose = locSettings.barTabs?.requireCloseTabsBeforeShift ?? true

  if (requireClose) {
    const openOrderCount = await tx.order.count({
      where: {
        locationId,
        employeeId,
        status: { in: ['open', 'sent', 'in_progress', 'split'] },
        deletedAt: null,
      },
    })

    if (openOrderCount > 0) {
      // Manager override: transfer orders and proceed
      if (forceClose && requestingEmployeeId !== employeeId) {
        // Capture order IDs before bulk update for event emission
        const ordersToTransfer = await tx.order.findMany({
          where: {
            locationId,
            employeeId,
            status: { in: ['open', 'sent', 'in_progress', 'split'] },
            deletedAt: null,
          },
          select: { id: true },
        })
        transferredOrderIds = ordersToTransfer.map(o => o.id)

        await tx.order.updateMany({
          where: {
            locationId,
            employeeId,
            status: { in: ['open', 'sent', 'in_progress', 'split'] },
            deletedAt: null,
          },
          data: { employeeId: requestingEmployeeId },
        })
      } else {
        throw new Error(`OPEN_ORDERS:${openOrderCount}`)
      }
    }
  }

  const serverGrossTips = summary.totalTips
  let actualTipOutTotal = 0
  let autoDistributed = false

  // Process tip distribution first to get actual tip-out totals
  if (tipDistribution) {
    actualTipOutTotal = await processTipDistribution(
      tx,
      locationId,
      employeeId,
      shiftId,
      tipDistribution,
      summary.salesData
    )
  } else if (locSettings.tipShares?.autoTipOutEnabled && serverGrossTips > 0) {
    // Auto tip distribution: load TipOutRules for the employee's role
    // and calculate tip-outs server-side without client involvement
    const autoResult = await autoProcessTipDistribution(
      tx,
      locationId,
      employeeId,
      workingRoleId,
      shiftId,
      serverGrossTips,
      summary.salesData,
      summary
    )
    actualTipOutTotal = autoResult.totalTipOut
    autoDistributed = autoResult.distributed
  }

  // Cap tip-outs so they never exceed gross tips (prevents negative net tips).
  // If rules produce a higher total, scale proportionally so the ratio is preserved.
  if (actualTipOutTotal > serverGrossTips && serverGrossTips > 0) {
    console.warn(
      `[Shift ${shiftId}] Tip-out total $${actualTipOutTotal.toFixed(2)} exceeds gross tips $${serverGrossTips.toFixed(2)} — capping to gross tips`
    )
    actualTipOutTotal = Math.round(serverGrossTips * 100) / 100
  } else if (serverGrossTips <= 0) {
    // No tips earned — zero out tip-outs to prevent negative net
    actualTipOutTotal = 0
  }

  // Server-side netTips = gross - tipOuts (never trust client values)
  const serverNetTips = Math.round((serverGrossTips - actualTipOutTotal) * 100) / 100

  const updatedShift = await tx.shift.update({
    where: { id: shiftId },
    data: {
      endedAt: endTime,
      status: 'closed',
      expectedCash,
      actualCash: effectiveActualCash,
      variance,
      totalSales: summary.totalSales,
      cashSales: summary.cashSales,
      cardSales: summary.cardSales,
      tipsDeclared: tipsDeclared || summary.totalTips,
      notes: notes || currentShiftNotes,
      grossTips: serverGrossTips,
      tipOutTotal: actualTipOutTotal,
      netTips: serverNetTips,
    },
    include: {
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
          roleId: true,
        },
      },
    },
  })

  // Audit log: shift closed
  await tx.auditLog.create({
    data: {
      locationId,
      employeeId: requestingEmployeeId || employeeId,
      action: 'shift_closed',
      entityType: 'shift',
      entityId: updatedShift.id,
      details: {
        shiftEmployeeId: employeeId,
        totalSales: summary.totalSales,
        cashSales: summary.cashSales,
        cardSales: summary.cardSales,
        expectedCash,
        actualCash: rawActualCash,
        variance,
        tipsDeclared: tipsDeclared || summary.totalTips,
        hasTipDistribution: !!tipDistribution || autoDistributed,
        autoTipDistribution: autoDistributed,
        serverGrossTips,
        actualTipOutTotal,
        serverNetTips,
      },
    },
  })

  return {
    updatedShift,
    transferredOrderIds,
    autoDistributed,
  }
}
