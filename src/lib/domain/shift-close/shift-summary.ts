/**
 * Shift Summary Calculations
 *
 * Calculates sales, tips, cash, and labor cost for a shift period.
 * Uses db directly (not tx) — called before the close transaction.
 */

import { db } from '@/lib/db'
import type { ShiftSummary, LaborCost } from './types'

export async function calculateShiftSummary(
  locationId: string,
  employeeId: string,
  startTime: Date,
  endTime: Date,
  drawerId?: string | null
): Promise<ShiftSummary> {
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
      cashSales += amount
      cashReceived += Number(payment.amountTendered || 0)
      changeGiven += Number(payment.changeGiven || 0)
    } else {
      cardSales += amount
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

  // Query paid-in/out for the shift period (drawer-aware if applicable)
  const paidInOutWhere: Parameters<typeof db.paidInOut.findMany>[0] = {
    where: {
      locationId,
      createdAt: {
        gte: startTime,
        lte: endTime,
      },
      ...(drawerId ? { drawerId } : { employeeId }),
    },
  }
  const paidInOuts = await db.paidInOut.findMany(paidInOutWhere)

  let paidIn = 0
  let paidOut = 0
  paidInOuts.forEach(pio => {
    const amount = Number(pio.amount) || 0
    if (pio.type === 'in') {
      paidIn += amount
    } else {
      paidOut += amount
    }
  })

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

  // SAF (Store-and-Forward) payment tracking for shift close visibility
  const safPendingPayments = await db.payment.findMany({
    where: {
      employeeId,
      safStatus: 'APPROVED_SAF_PENDING_UPLOAD',
      processedAt: {
        gte: startTime,
        lte: endTime,
      },
      order: { locationId },
    },
    select: { amount: true, tipAmount: true },
  })
  const safPendingCount = safPendingPayments.length
  const safPendingTotal = safPendingPayments.reduce((sum, p) => sum + Number(p.amount) + Number(p.tipAmount), 0)

  const safFailedPayments = await db.payment.findMany({
    where: {
      employeeId,
      safStatus: { in: ['UPLOAD_FAILED', 'NEEDS_ATTENTION'] },
      processedAt: {
        gte: startTime,
        lte: endTime,
      },
      order: { locationId },
    },
    select: { amount: true, tipAmount: true },
  })
  const safFailedCount = safFailedPayments.length
  const safFailedTotal = safFailedPayments.reduce((sum, p) => sum + Number(p.amount) + Number(p.tipAmount), 0)

  return {
    totalSales: Math.round(totalSales * 100) / 100,
    cashSales: Math.round(cashSales * 100) / 100,
    cardSales: Math.round(cardSales * 100) / 100,
    totalTips: Math.round(totalTips * 100) / 100,
    totalCommission: Math.round(totalCommission * 100) / 100,
    cashReceived: Math.round(cashReceived * 100) / 100,
    changeGiven: Math.round(changeGiven * 100) / 100,
    netCashReceived: Math.round(netCashReceived * 100) / 100,
    paidIn: Math.round(paidIn * 100) / 100,
    paidOut: Math.round(paidOut * 100) / 100,
    orderCount,
    paymentCount,
    voidCount: voids,
    compCount: comps,
    salesData: {
      totalSales: Math.round(totalSales * 100) / 100,
      foodSales: Math.round(foodSales * 100) / 100,
      barSales: Math.round(barSales * 100) / 100,
      netSales: Math.round(netSales * 100) / 100,
    },
    safPendingCount,
    safPendingTotal: Math.round(safPendingTotal * 100) / 100,
    safFailedCount,
    safFailedTotal: Math.round(safFailedTotal * 100) / 100,
    laborCost: await calculateShiftLaborCost(locationId, startTime, endTime),
  }
}

// I-1: Calculate labor cost for the shift period (all employees clocked in during window)
async function calculateShiftLaborCost(
  locationId: string,
  startTime: Date,
  endTime: Date
): Promise<LaborCost | null> {
  try {
    // Find all time clock entries overlapping with this shift window
    const entries = await db.timeClockEntry.findMany({
      where: {
        locationId,
        clockIn: { lte: endTime },
        OR: [
          { clockOut: { gte: startTime } },
          { clockOut: null }, // Still clocked in
        ],
      },
      include: {
        employee: {
          select: { hourlyRate: true },
        },
      },
    })

    let totalWages = 0
    let totalHours = 0

    entries.forEach(entry => {
      const rate = Number(entry.employee.hourlyRate) || 0
      if (rate === 0) return

      const regularHours = Number(entry.regularHours) || 0
      const overtimeHours = Number(entry.overtimeHours) || 0

      if (entry.clockOut) {
        // Completed entry — use stored hours
        totalHours += regularHours + overtimeHours
        totalWages += (regularHours * rate) + (overtimeHours * rate * 1.5)
      } else {
        // Still clocked in — calculate hours so far
        const hoursWorked = (endTime.getTime() - entry.clockIn.getTime()) / (1000 * 60 * 60)
        const breakHours = (entry.breakMinutes || 0) / 60
        const netHours = Math.max(0, hoursWorked - breakHours)
        totalHours += netHours
        totalWages += netHours * rate
      }
    })

    return {
      totalWages: Math.round(totalWages * 100) / 100,
      totalHours: Math.round(totalHours * 100) / 100,
      employeeCount: entries.length,
    }
  } catch {
    return null
  }
}
