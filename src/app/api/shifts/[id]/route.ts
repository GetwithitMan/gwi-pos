import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { postToTipLedger, dollarsToCents } from '@/lib/domain/tips'
import { withVenue } from '@/lib/with-venue'
import { emitToLocation } from '@/lib/socket-server'
import { emitCloudEvent } from '@/lib/cloud-events'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'

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
        notes: shift.notes,
      },
      summary: shiftSummary,
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

      // Expected cash = starting cash + cash received - change given
      const expectedCash = Number(shift.startingCash) + summary.netCashReceived
      const variance = effectiveActualCash - expectedCash

      // Update shift + process tip distribution atomically
      // Open order check is inside the transaction to prevent TOCTOU race condition
      // Server-side computation of grossTips/tipOutTotal/netTips (BUG #417/#421 fix)
      const updatedShift = await db.$transaction(async (tx) => {
        // Check if employee has open orders (requireCloseTabsBeforeShift setting)
        const locationSettings = await getLocationSettings(shift.locationId)
        const locSettings = parseSettings(locationSettings)
        const requireClose = locSettings.barTabs?.requireCloseTabsBeforeShift ?? true

        if (requireClose) {
          const openOrderCount = await tx.order.count({
            where: {
              locationId: shift.locationId,
              employeeId: shift.employeeId,
              status: { in: ['open', 'sent', 'in_progress', 'split'] },
              deletedAt: null,
            },
          })

          if (openOrderCount > 0) {
            // Manager override: transfer orders and proceed
            if (forceClose && requestingEmployeeId !== shift.employeeId) {
              await tx.order.updateMany({
                where: {
                  locationId: shift.locationId,
                  employeeId: shift.employeeId,
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

        // Process tip distribution first to get actual tip-out totals
        if (tipDistribution) {
          actualTipOutTotal = await processTipDistribution(
            tx,
            shift.locationId,
            shift.employeeId,
            id,
            tipDistribution,
            summary.salesData
          )
        }

        // Cap tip-outs so they never exceed gross tips (prevents negative net tips).
        // If rules produce a higher total, scale proportionally so the ratio is preserved.
        if (actualTipOutTotal > serverGrossTips && serverGrossTips > 0) {
          console.warn(
            `[Shift ${id}] Tip-out total $${actualTipOutTotal.toFixed(2)} exceeds gross tips $${serverGrossTips.toFixed(2)} — capping to gross tips`
          )
          actualTipOutTotal = Math.round(serverGrossTips * 100) / 100
        } else if (serverGrossTips <= 0) {
          // No tips earned — zero out tip-outs to prevent negative net
          actualTipOutTotal = 0
        }

        // Server-side netTips = gross - tipOuts (never trust client values)
        const serverNetTips = Math.round((serverGrossTips - actualTipOutTotal) * 100) / 100

        const closed = await tx.shift.update({
          where: { id },
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
            notes: notes || shift.notes,
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
            locationId: shift.locationId,
            employeeId: requestingEmployeeId || shift.employeeId,
            action: 'shift_closed',
            entityType: 'shift',
            entityId: closed.id,
            details: {
              shiftEmployeeId: shift.employeeId,
              totalSales: summary.totalSales,
              cashSales: summary.cashSales,
              cardSales: summary.cardSales,
              expectedCash,
              actualCash,
              variance,
              tipsDeclared: tipsDeclared || summary.totalTips,
              hasTipDistribution: !!tipDistribution,
              serverGrossTips,
              actualTipOutTotal,
              serverNetTips,
            },
          },
        })

        return closed
      })

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
          notes: updatedShift.notes,
        },
        summary,
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
      return NextResponse.json(
        {
          error: 'Cannot close shift with open orders',
          openOrderCount,
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

// Helper function to calculate shift summary
async function calculateShiftSummary(
  locationId: string,
  employeeId: string,
  startTime: Date,
  endTime: Date,
  drawerId?: string | null
) {
  // Get all completed payments by this employee during the shift
  const payments = await db.payment.findMany({
    where: {
      employeeId,
      status: 'completed',
      processedAt: {
        gte: startTime,
        lte: endTime,
      },
      order: {
        locationId,
      },
    },
    include: {
      order: {
        select: {
          id: true,
          orderNumber: true,
          total: true,
        },
      },
    },
  })

  // Get all orders created by this employee during the shift
  const orders = await db.order.findMany({
    where: {
      employeeId,
      locationId,
      createdAt: {
        gte: startTime,
        lte: endTime,
      },
      status: { in: ['paid', 'closed'] },
    },
    select: {
      id: true,
      total: true,
      tipTotal: true,
      discountTotal: true,
      commissionTotal: true,
    },
  })

  // Calculate total commission earned
  const totalCommission = orders.reduce((sum, order) => sum + Number(order.commissionTotal || 0), 0)

  // Calculate totals
  let totalSales = 0
  let cashSales = 0
  let cardSales = 0
  let totalTips = 0
  let cashReceived = 0
  let changeGiven = 0

  payments.forEach(payment => {
    const amount = Number(payment.amount)
    const tip = Number(payment.tipAmount)

    totalSales += amount
    totalTips += tip

    if (payment.paymentMethod === 'cash') {
      cashSales += amount + tip
      cashReceived += Number(payment.amountTendered || 0)
      changeGiven += Number(payment.changeGiven || 0)
    } else {
      cardSales += amount + tip
    }
  })

  // Net cash received = cash tendered - change given
  let netCashReceived = cashReceived - changeGiven

  // DRAWER MODE: Override cash figures with ALL cash to this physical drawer
  // This ensures expected cash includes cash from other employees (e.g., manager at bartender's terminal)
  if (drawerId) {
    const drawerCashPayments = await db.payment.findMany({
      where: {
        drawerId,
        paymentMethod: 'cash',
        status: 'completed',
        processedAt: {
          gte: startTime,
          lte: endTime,
        },
        order: {
          locationId,
        },
      },
      select: {
        amountTendered: true,
        changeGiven: true,
      },
    })

    let drawerCashReceived = 0
    let drawerChangeGiven = 0
    drawerCashPayments.forEach(p => {
      drawerCashReceived += Number(p.amountTendered || 0)
      drawerChangeGiven += Number(p.changeGiven || 0)
    })
    cashReceived = drawerCashReceived
    changeGiven = drawerChangeGiven
    netCashReceived = drawerCashReceived - drawerChangeGiven
  }

  // Calculate sales by category type for tip-out basis
  // Query order items for paid/closed orders and aggregate by categoryType
  const orderIds = orders.map(o => o.id)
  let foodSales = 0
  let barSales = 0
  let totalDiscounts = 0

  if (orderIds.length > 0) {
    const orderItems = await db.orderItem.findMany({
      where: {
        orderId: { in: orderIds },
        status: { notIn: ['voided', 'comped'] },
      },
      select: {
        price: true,
        quantity: true,
        categoryType: true,
      },
    })

    orderItems.forEach(item => {
      const itemTotal = Number(item.price) * item.quantity
      const catType = item.categoryType

      if (catType === 'food' || catType === 'combos') {
        foodSales += itemTotal
      } else if (catType === 'drinks' || catType === 'liquor') {
        barSales += itemTotal
      }
    })

    totalDiscounts = orders.reduce((sum, order) => sum + Number(order.discountTotal || 0), 0)
  }

  const netSales = totalSales - totalDiscounts

  // Count orders and payments
  const orderCount = orders.length
  const paymentCount = payments.length

  // Get voids/comps during shift (count items with voided/comped status on orders in this period)
  const voids = await db.orderItem.count({
    where: {
      order: {
        employeeId,
        locationId,
        createdAt: {
          gte: startTime,
          lte: endTime,
        },
      },
      status: 'voided',
    },
  })

  const comps = await db.orderItem.count({
    where: {
      order: {
        employeeId,
        locationId,
        createdAt: {
          gte: startTime,
          lte: endTime,
        },
      },
      status: 'comped',
    },
  })

  return {
    totalSales: Math.round(totalSales * 100) / 100,
    cashSales: Math.round(cashSales * 100) / 100,
    cardSales: Math.round(cardSales * 100) / 100,
    totalTips: Math.round(totalTips * 100) / 100,
    totalCommission: Math.round(totalCommission * 100) / 100,
    cashReceived: Math.round(cashReceived * 100) / 100,
    changeGiven: Math.round(changeGiven * 100) / 100,
    netCashReceived: Math.round(netCashReceived * 100) / 100,
    orderCount,
    paymentCount,
    voidCount: voids,
    compCount: comps,
    // Sales breakdown by category type (for tip-out basis calculations)
    salesData: {
      totalSales: Math.round(totalSales * 100) / 100,
      foodSales: Math.round(foodSales * 100) / 100,
      barSales: Math.round(barSales * 100) / 100,
      netSales: Math.round(netSales * 100) / 100,
    },
  }
}

// Helper function to process tip distribution
// Returns the actual total tip-out amount (server-computed, BUG #417/#421 fix)
async function processTipDistribution(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  locationId: string,
  fromEmployeeId: string,
  shiftId: string,
  tipDistribution: {
    grossTips: number
    tipOutTotal: number
    netTips: number
    roleTipOuts: { ruleId: string; toRoleId: string; amount: number }[]
    customShares: { toEmployeeId: string; amount: number }[]
  },
  salesData?: { totalSales: number; foodSales: number; barSales: number; netSales: number }
): Promise<number> {
  let actualTipOutTotal = 0

  // Get all currently clocked-in employees to determine if recipients are on shift
  const activeShifts = await tx.shift.findMany({
    where: {
      locationId,
      status: 'open',
    },
    select: {
      employeeId: true,
      employee: {
        select: {
          id: true,
          roleId: true,
        },
      },
    },
  })

  const activeEmployeeIds = new Set(activeShifts.map(s => s.employeeId))

  // Map roleId to ALL active employees with that role, excluding sender (BUG #408 fix)
  const activeEmployeesByRole = new Map<string, string[]>()
  activeShifts.forEach(s => {
    if (s.employee.roleId && s.employee.id !== fromEmployeeId) {
      const existing = activeEmployeesByRole.get(s.employee.roleId) || []
      existing.push(s.employee.id)
      activeEmployeesByRole.set(s.employee.roleId, existing)
    }
  })

  // Process role-based tip-outs
  for (const tipOut of tipDistribution.roleTipOuts) {
    if (tipOut.amount <= 0) continue

    // Server-side recalculation for sales-based tip-out rules
    let effectiveAmount = tipOut.amount
    if (tipOut.ruleId && salesData) {
      const rule = await tx.tipOutRule.findUnique({
        where: { id: tipOut.ruleId },
        select: { basisType: true, percentage: true, maxPercentage: true },
      })

      if (rule && rule.basisType !== 'tips_earned') {
        // Determine the basis amount based on the rule's basisType
        let basisAmount: number
        switch (rule.basisType) {
          case 'food_sales':
            basisAmount = salesData.foodSales
            break
          case 'bar_sales':
            basisAmount = salesData.barSales
            break
          case 'total_sales':
            basisAmount = salesData.totalSales
            break
          case 'net_sales':
            basisAmount = salesData.netSales
            break
          default:
            basisAmount = tipDistribution.grossTips
        }

        // Recalculate: basisAmount * (percentage / 100)
        const percentage = Number(rule.percentage)
        effectiveAmount = Math.round(basisAmount * (percentage / 100) * 100) / 100

        // Apply maxPercentage compliance cap if set
        if (rule.maxPercentage) {
          const maxPct = Number(rule.maxPercentage)
          const maxAmount = Math.round(tipDistribution.grossTips * (maxPct / 100) * 100) / 100
          if (effectiveAmount > maxAmount) {
            effectiveAmount = maxAmount
          }
        }

        // Don't allow negative tip-outs
        if (effectiveAmount < 0) effectiveAmount = 0
      }
    }

    if (effectiveAmount <= 0) continue

    // Find ALL active employees with this role (BUG #408 fix)
    let recipients = activeEmployeesByRole.get(tipOut.toRoleId) || []
    let bankStatus: 'pending' | 'banked' = 'pending'

    if (recipients.length === 0) {
      // No active employees with this role — find ALL employees with this role for banking
      const employeesWithRole = await tx.employee.findMany({
        where: {
          locationId,
          roleId: tipOut.toRoleId,
          isActive: true,
          id: { not: fromEmployeeId },
        },
        select: { id: true },
      })

      if (employeesWithRole.length === 0) {
        console.warn(`No employees found with role ${tipOut.toRoleId} for tip-out`)
        continue
      }

      recipients = employeesWithRole.map(e => e.id)
      bankStatus = 'banked'
    }

    // Split amount evenly among all recipients, handle rounding (BUG #408 fix)
    const totalCents = dollarsToCents(effectiveAmount)
    const perPersonCents = Math.floor(totalCents / recipients.length)
    const remainderCents = totalCents - (perPersonCents * recipients.length)

    for (let i = 0; i < recipients.length; i++) {
      // Distribute remainder pennies round-robin (1 cent each) instead of all to first
      const recipientCents = perPersonCents + (i < remainderCents ? 1 : 0)
      if (recipientCents <= 0) continue
      const recipientDollars = recipientCents / 100

      // Create TipShare record per recipient
      const tipShare = await tx.tipShare.create({
        data: {
          locationId,
          shiftId,
          fromEmployeeId,
          toEmployeeId: recipients[i],
          amount: recipientDollars,
          shareType: 'role_tipout',
          ruleId: tipOut.ruleId,
          status: bankStatus,
        },
      })

      // Post paired ledger entries INSIDE the transaction (Skill 284)
      await postToTipLedger({
        locationId,
        employeeId: fromEmployeeId,
        amountCents: recipientCents,
        type: 'DEBIT',
        sourceType: 'ROLE_TIPOUT',
        sourceId: tipShare.id,
        shiftId,
        memo: `Role tip-out to ${tipOut.toRoleId}`,
      }, tx)

      await postToTipLedger({
        locationId,
        employeeId: recipients[i],
        amountCents: recipientCents,
        type: 'CREDIT',
        sourceType: 'ROLE_TIPOUT',
        sourceId: tipShare.id,
        shiftId,
        memo: `Role tip-out from shift close`,
      }, tx)
    }

    actualTipOutTotal += effectiveAmount
  }

  // Process custom shares
  for (const share of tipDistribution.customShares) {
    if (share.amount <= 0) continue

    const isOnShift = activeEmployeeIds.has(share.toEmployeeId)
    const status = isOnShift ? 'pending' : 'banked'

    // Create TipShare record
    const tipShare = await tx.tipShare.create({
      data: {
        locationId,
        shiftId,
        fromEmployeeId,
        toEmployeeId: share.toEmployeeId,
        amount: share.amount,
        shareType: 'custom',
        status,
      },
    })

    // Post paired ledger entries INSIDE the transaction (Skill 284)
    const shareAmountCents = dollarsToCents(share.amount)
    await postToTipLedger({
      locationId,
      employeeId: fromEmployeeId,
      amountCents: shareAmountCents,
      type: 'DEBIT',
      sourceType: 'MANUAL_TRANSFER',
      sourceId: tipShare.id,
      shiftId,
      memo: `Custom tip share`,
    }, tx)

    await postToTipLedger({
      locationId,
      employeeId: share.toEmployeeId,
      amountCents: shareAmountCents,
      type: 'CREDIT',
      sourceType: 'MANUAL_TRANSFER',
      sourceId: tipShare.id,
      shiftId,
      memo: `Custom tip share received`,
    }, tx)

    actualTipOutTotal += share.amount
  }

  return Math.round(actualTipOutTotal * 100) / 100
}
