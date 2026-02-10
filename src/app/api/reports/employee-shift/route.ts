import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getBusinessDayRange, getCurrentBusinessDay } from '@/lib/business-day'
import { parseSettings } from '@/lib/settings'

// GET - Generate employee shift report
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const shiftId = searchParams.get('shiftId')
    const employeeId = searchParams.get('employeeId')
    const locationId = searchParams.get('locationId')
    const dateStr = searchParams.get('date')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId') || employeeId

    // Can query by shiftId OR by employeeId + date
    if (!shiftId && (!employeeId || !locationId)) {
      return NextResponse.json(
        { error: 'Either shiftId or (employeeId + locationId) required' },
        { status: 400 }
      )
    }

    // Auth check (locationId may be null when querying by shiftId — resolved after shift lookup)
    if (locationId) {
      // Self-access: employees can always view their own shift report
      const isSelfAccess = employeeId && requestingEmployeeId && employeeId === requestingEmployeeId
      if (!isSelfAccess) {
        const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_SALES_BY_EMPLOYEE, { soft: true })
        if (!auth.authorized) {
          return NextResponse.json({ error: auth.error }, { status: auth.status })
        }
      }
    }

    let shift
    let employee
    let shiftStart: Date
    let shiftEnd: Date

    if (shiftId) {
      // Get shift directly
      shift = await db.shift.findUnique({
        where: { id: shiftId },
        include: {
          employee: {
            include: {
              role: true,
            },
          },
        },
      })

      if (!shift) {
        return NextResponse.json({ error: 'Shift not found' }, { status: 404 })
      }

      employee = shift.employee
      shiftStart = shift.startedAt
      shiftEnd = shift.endedAt || new Date()
    } else {
      // Find shift by employee and date using business day boundaries
      const shiftLocation = await db.location.findUnique({
        where: { id: locationId! },
        select: { settings: true },
      })
      const locationSettings = parseSettings(shiftLocation?.settings)
      const dayStartTime = locationSettings.businessDay.dayStartTime

      let startOfDay: Date
      let endOfDay: Date

      if (dateStr) {
        const range = getBusinessDayRange(dateStr, dayStartTime)
        startOfDay = range.start
        endOfDay = range.end
      } else {
        const current = getCurrentBusinessDay(dayStartTime)
        startOfDay = current.start
        endOfDay = current.end
      }

      shift = await db.shift.findFirst({
        where: {
          employeeId: employeeId!,
          locationId: locationId!,
          startedAt: { gte: startOfDay, lte: endOfDay },
        },
        include: {
          employee: {
            include: {
              role: true,
            },
          },
        },
        orderBy: { startedAt: 'desc' },
      })

      if (!shift) {
        // Try time clock entry instead
        const timeEntry = await db.timeClockEntry.findFirst({
          where: {
            employeeId: employeeId!,
            locationId: locationId!,
            clockIn: { gte: startOfDay, lte: endOfDay },
          },
          include: {
            employee: {
              include: {
                role: true,
              },
            },
          },
          orderBy: { clockIn: 'desc' },
        })

        if (!timeEntry) {
          return NextResponse.json({ error: 'No shift found for this employee on this date' }, { status: 404 })
        }

        employee = timeEntry.employee
        shiftStart = timeEntry.clockIn
        shiftEnd = timeEntry.clockOut || new Date()
      } else {
        employee = shift.employee
        shiftStart = shift.startedAt
        shiftEnd = shift.endedAt || new Date()
      }
    }

    const locationIdToUse = shift?.locationId || locationId!

    // Fetch all orders for this employee during the shift
    const orders = await db.order.findMany({
      where: {
        locationId: locationIdToUse,
        employeeId: employee.id,
        createdAt: { gte: shiftStart, lte: shiftEnd },
        status: { in: ['completed', 'closed', 'paid'] },
      },
      include: {
        items: {
          include: {
            menuItem: {
              include: {
                category: true,
              },
            },
          },
        },
        payments: true,
        discounts: {
          include: {
            discountRule: true,
          },
        },
      },
    })

    // Fetch voided orders for this employee
    const voidedOrders = await db.order.findMany({
      where: {
        locationId: locationIdToUse,
        employeeId: employee.id,
        createdAt: { gte: shiftStart, lte: shiftEnd },
        status: 'voided',
      },
      include: {
        items: {
          include: {
            menuItem: {
              include: {
                category: true,
              },
            },
          },
        },
      },
    })

    // Fetch void logs for this employee
    const voidLogs = await db.voidLog.findMany({
      where: {
        locationId: locationIdToUse,
        employeeId: employee.id,
        createdAt: { gte: shiftStart, lte: shiftEnd },
      },
    })

    // Migrated from legacy TipShare (Skill 273)
    // Fetch tip-out credits received by this employee from TipLedgerEntry
    const tipOutsReceived = await db.tipLedgerEntry.findMany({
      where: {
        employeeId: employee.id,
        locationId: locationIdToUse,
        sourceType: 'ROLE_TIPOUT',
        type: 'CREDIT',
        deletedAt: null,
        createdAt: { gte: shiftStart, lte: shiftEnd },
      },
    })

    // Migrated from legacy TipShare (Skill 273)
    // Fetch tip-out debits given by this employee from TipLedgerEntry
    const tipOutsGiven = await db.tipLedgerEntry.findMany({
      where: {
        employeeId: employee.id,
        locationId: locationIdToUse,
        sourceType: 'ROLE_TIPOUT',
        type: 'DEBIT',
        deletedAt: null,
        createdAt: { gte: shiftStart, lte: shiftEnd },
      },
    })

    // Resolve counterparty employees for the tip-out detail lines.
    // Each DEBIT has a paired CREDIT (and vice versa) sharing the same sourceId.
    // Collect all sourceIds, then batch-fetch counterparty entries + employee names.
    const allSourceIds = [
      ...tipOutsReceived.map(e => e.sourceId).filter(Boolean),
      ...tipOutsGiven.map(e => e.sourceId).filter(Boolean),
    ] as string[]

    // For received (CREDITs), the counterparty is the DEBIT with the same sourceId
    // For given (DEBITs), the counterparty is the CREDIT with the same sourceId
    const counterpartyEntries = allSourceIds.length > 0
      ? await db.tipLedgerEntry.findMany({
          where: {
            sourceId: { in: allSourceIds },
            sourceType: 'ROLE_TIPOUT',
            deletedAt: null,
            employeeId: { not: employee.id },
          },
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                displayName: true,
              },
            },
          },
        })
      : []

    // Build sourceId -> counterparty employee lookup
    const counterpartyBySourceId = new Map<string, { id: string; firstName: string; lastName: string; displayName: string | null }>()
    for (const entry of counterpartyEntries) {
      if (entry.sourceId) {
        counterpartyBySourceId.set(entry.sourceId, entry.employee)
      }
    }

    // Fetch categories
    const categories = await db.category.findMany({
      where: { locationId: locationIdToUse },
    })

    // ============================================
    // CALCULATE REVENUE
    // ============================================

    let adjustedGrossSales = 0
    let totalDiscounts = 0
    let totalTax = 0
    let totalSurcharge = 0
    let totalTips = 0
    let totalGratuity = 0
    let totalRefunds = 0
    let totalCommission = 0

    // Sales by category
    const salesByCategory: Record<string, {
      name: string
      categoryType: string
      units: number
      gross: number
      discounts: number
      net: number
      voids: number
    }> = {}

    // Initialize categories
    categories.forEach(cat => {
      salesByCategory[cat.id] = {
        name: cat.name,
        categoryType: cat.categoryType || 'food',
        units: 0,
        gross: 0,
        discounts: 0,
        net: 0,
        voids: 0,
      }
    })

    // Process orders
    orders.forEach(order => {
      const orderSubtotal = Number(order.subtotal) || 0
      const orderTax = Number(order.taxTotal) || 0
      const orderTip = Number(order.tipTotal) || 0
      const orderDiscount = Number(order.discountTotal) || 0
      const orderCommission = Number(order.commissionTotal) || 0

      adjustedGrossSales += orderSubtotal
      totalDiscounts += orderDiscount
      totalTax += orderTax
      totalTips += orderTip
      totalCommission += orderCommission

      // Track by category
      order.items.forEach(item => {
        const itemTotal = Number(item.price) * item.quantity
        const categoryId = item.menuItem?.category?.id

        if (categoryId && salesByCategory[categoryId]) {
          salesByCategory[categoryId].units += item.quantity
          salesByCategory[categoryId].gross += itemTotal
        }
      })

      // Distribute discounts to categories
      if (orderDiscount > 0 && orderSubtotal > 0) {
        order.items.forEach(item => {
          const itemTotal = Number(item.price) * item.quantity
          const itemDiscountShare = (itemTotal / orderSubtotal) * orderDiscount
          const categoryId = item.menuItem?.category?.id
          if (categoryId && salesByCategory[categoryId]) {
            salesByCategory[categoryId].discounts += itemDiscountShare
          }
        })
      }
    })

    // Calculate net for each category
    Object.values(salesByCategory).forEach(cat => {
      cat.net = cat.gross - cat.discounts
    })

    // Calculate voids by category
    voidedOrders.forEach(order => {
      order.items.forEach(item => {
        const itemTotal = Number(item.price) * item.quantity
        const categoryId = item.menuItem?.category?.id
        if (categoryId && salesByCategory[categoryId]) {
          salesByCategory[categoryId].voids += itemTotal
        }
      })
    })

    const netSales = adjustedGrossSales - totalDiscounts
    const grossSales = netSales + totalTax + totalSurcharge
    const totalCollected = grossSales + totalTips - totalRefunds

    // ============================================
    // CALCULATE PAYMENTS
    // ============================================

    const paymentsByType: Record<string, {
      count: number
      amount: number
      tips: number
    }> = {
      cash: { count: 0, amount: 0, tips: 0 },
      credit: { count: 0, amount: 0, tips: 0 },
      gift: { count: 0, amount: 0, tips: 0 },
      house_account: { count: 0, amount: 0, tips: 0 },
      other: { count: 0, amount: 0, tips: 0 },
    }

    const creditCardBreakdown: Record<string, { count: number; amount: number }> = {
      visa: { count: 0, amount: 0 },
      mastercard: { count: 0, amount: 0 },
      amex: { count: 0, amount: 0 },
      discover: { count: 0, amount: 0 },
      other: { count: 0, amount: 0 },
    }

    orders.forEach(order => {
      order.payments.forEach(payment => {
        const paymentType = (payment.paymentMethod || 'other').toLowerCase()
        const amount = Number(payment.amount) || 0
        const tip = Number(payment.tipAmount) || 0

        if (paymentType === 'cash') {
          paymentsByType.cash.count++
          paymentsByType.cash.amount += amount
          paymentsByType.cash.tips += tip
        } else if (paymentType === 'credit' || paymentType === 'card') {
          paymentsByType.credit.count++
          paymentsByType.credit.amount += amount
          paymentsByType.credit.tips += tip

          const cardType = (payment.cardBrand || 'other').toLowerCase()
          if (cardType.includes('visa')) {
            creditCardBreakdown.visa.count++
            creditCardBreakdown.visa.amount += amount
          } else if (cardType.includes('master')) {
            creditCardBreakdown.mastercard.count++
            creditCardBreakdown.mastercard.amount += amount
          } else if (cardType.includes('amex') || cardType.includes('american')) {
            creditCardBreakdown.amex.count++
            creditCardBreakdown.amex.amount += amount
          } else if (cardType.includes('discover')) {
            creditCardBreakdown.discover.count++
            creditCardBreakdown.discover.amount += amount
          } else {
            creditCardBreakdown.other.count++
            creditCardBreakdown.other.amount += amount
          }
        } else if (paymentType === 'gift' || paymentType === 'gift_card') {
          paymentsByType.gift.count++
          paymentsByType.gift.amount += amount
          paymentsByType.gift.tips += tip
        } else if (paymentType === 'house_account') {
          paymentsByType.house_account.count++
          paymentsByType.house_account.amount += amount
        } else {
          paymentsByType.other.count++
          paymentsByType.other.amount += amount
          paymentsByType.other.tips += tip
        }
      })
    })

    const totalPayments = Object.values(paymentsByType).reduce(
      (sum, p) => sum + p.amount,
      0
    )

    // ============================================
    // CASH RECONCILIATION
    // ============================================

    const cashReceived = paymentsByType.cash.amount
    const cashTipsOwed = paymentsByType.credit.tips // Credit card tips owed to employee
    const cashDue = cashReceived // Cash employee owes the house

    // ============================================
    // VOIDS
    // ============================================

    let voidedTicketCount = 0
    let voidedTicketAmount = 0
    let voidedItemCount = 0
    let voidedItemAmount = 0

    const voidsByReason: Record<string, { count: number; amount: number }> = {}

    voidLogs.forEach(log => {
      const amount = Number(log.amount) || 0
      const reason = log.reason || 'Unknown'

      if (!voidsByReason[reason]) {
        voidsByReason[reason] = { count: 0, amount: 0 }
      }
      voidsByReason[reason].count++
      voidsByReason[reason].amount += amount

      if (log.itemId) {
        voidedItemCount++
        voidedItemAmount += amount
      } else {
        voidedTicketCount++
        voidedTicketAmount += amount
      }
    })

    const totalVoids = voidedTicketAmount + voidedItemAmount
    const voidPercentage = adjustedGrossSales > 0 ? (totalVoids / adjustedGrossSales) * 100 : 0

    // ============================================
    // DISCOUNTS BREAKDOWN
    // ============================================

    const discountsByType: Record<string, { count: number; amount: number }> = {}

    orders.forEach(order => {
      order.discounts.forEach(discount => {
        const name = discount.discountRule?.name || discount.name || 'Unknown'
        const amount = Number(discount.amount) || 0

        if (!discountsByType[name]) {
          discountsByType[name] = { count: 0, amount: 0 }
        }
        discountsByType[name].count++
        discountsByType[name].amount += amount
      })
    })

    // ============================================
    // LABOR
    // ============================================

    const shiftHours = (shiftEnd.getTime() - shiftStart.getTime()) / (1000 * 60 * 60)
    const hourlyRate = Number(employee.hourlyRate) || 0
    const laborCost = shiftHours * hourlyRate

    // ============================================
    // STATS
    // ============================================

    const checkCount = orders.length
    const avgCheck = checkCount > 0 ? totalCollected / checkCount : 0

    let totalCovers = 0
    orders.forEach(order => {
      totalCovers += order.guestCount || 1
    })
    const avgCover = totalCovers > 0 ? totalCollected / totalCovers : 0

    // Average check time
    let totalCheckTime = 0
    let checkTimeCount = 0
    orders.forEach(order => {
      if (order.closedAt && order.createdAt) {
        const minutes = (order.closedAt.getTime() - order.createdAt.getTime()) / (1000 * 60)
        totalCheckTime += minutes
        checkTimeCount++
      }
    })
    const avgCheckTime = checkTimeCount > 0 ? totalCheckTime / checkTimeCount : 0

    // Food/Bev breakdown
    let foodTotal = 0
    let bevTotal = 0
    let retailTotal = 0

    Object.values(salesByCategory).forEach(cat => {
      if (cat.categoryType === 'food') {
        foodTotal += cat.net
      } else if (
        cat.categoryType === 'drinks' ||
        cat.categoryType === 'liquor' ||
        cat.categoryType === 'beer' ||
        cat.categoryType === 'wine'
      ) {
        bevTotal += cat.net
      } else if (cat.categoryType === 'retail') {
        retailTotal += cat.net
      }
    })

    const foodAvg = checkCount > 0 ? foodTotal / checkCount : 0
    const bevAvg = checkCount > 0 ? bevTotal / checkCount : 0
    const retailAvg = checkCount > 0 ? retailTotal / checkCount : 0

    // ============================================
    // TIP SHARES SUMMARY
    // Tips EARNED from orders (subject to tip-out)
    // Tips RECEIVED from others (NOT subject to tip-out)
    // ============================================

    const tipsEarned = totalTips // Tips from orders this employee earned
    // Migrated from legacy TipShare (Skill 273)
    // amountCents is positive for CREDIT, negative for DEBIT in the ledger;
    // however the query already filters by type, so DEBIT amountCents are stored
    // as positive magnitude. Use Math.abs to be safe.
    const tipsGivenTotal = tipOutsGiven.reduce((sum, e) => sum + Math.abs(e.amountCents), 0) / 100
    const tipsReceivedTotal = tipOutsReceived.reduce((sum, e) => sum + e.amountCents, 0) / 100
    // TipLedgerEntry doesn't have a pending/collected status distinction;
    // all posted entries are considered collected (the ledger is the source of truth).
    const tipsReceivedPending = 0
    const tipsReceivedCollected = tipsReceivedTotal

    // Net tips = earned - given + received (collected)
    const netTipsCalculated = tipsEarned - tipsGivenTotal + tipsReceivedCollected

    // Group categories by type for revenue groups
    const revenueGroups: Record<string, { name: string; gross: number; net: number; discounts: number; voids: number }> = {
      beverage: { name: 'BEVERAGE', gross: 0, net: 0, discounts: 0, voids: 0 },
      food: { name: 'FOOD', gross: 0, net: 0, discounts: 0, voids: 0 },
      retail: { name: 'RETAIL', gross: 0, net: 0, discounts: 0, voids: 0 },
    }

    Object.values(salesByCategory).forEach(cat => {
      if (cat.categoryType === 'food') {
        revenueGroups.food.gross += cat.gross
        revenueGroups.food.net += cat.net
        revenueGroups.food.discounts += cat.discounts
        revenueGroups.food.voids += cat.voids
      } else if (
        cat.categoryType === 'drinks' ||
        cat.categoryType === 'liquor' ||
        cat.categoryType === 'beer' ||
        cat.categoryType === 'wine'
      ) {
        revenueGroups.beverage.gross += cat.gross
        revenueGroups.beverage.net += cat.net
        revenueGroups.beverage.discounts += cat.discounts
        revenueGroups.beverage.voids += cat.voids
      } else if (cat.categoryType === 'retail') {
        revenueGroups.retail.gross += cat.gross
        revenueGroups.retail.net += cat.net
        revenueGroups.retail.discounts += cat.discounts
        revenueGroups.retail.voids += cat.voids
      }
    })

    // ============================================
    // BUILD RESPONSE
    // ============================================

    return NextResponse.json({
      employee: {
        id: employee.id,
        name: employee.displayName || `${employee.firstName} ${employee.lastName}`,
        role: employee.role?.name || 'Unknown',
      },

      shift: {
        id: shift?.id || null,
        clockIn: shiftStart.toISOString(),
        clockOut: shiftEnd.toISOString(),
        hours: round(shiftHours),
        hourlyRate: round(hourlyRate),
        laborCost: round(laborCost),
      },

      // Header summary (like the example: $2,572.30 | 9.53 hrs | $71.50 | 172 | $15.68 | $120.48 | $19.99 | $0.00 | $102.32 | $500.98)
      summary: {
        totalSales: round(totalCollected),
        hours: round(shiftHours),
        laborCost: round(laborCost),
        checks: checkCount,
        avgCheck: round(avgCheck),
        tips: round(totalTips + paymentsByType.credit.tips),
        discounts: round(totalDiscounts),
        voids: round(totalVoids),
        cashDue: round(cashDue),
        creditTips: round(paymentsByType.credit.tips),
      },

      revenue: {
        adjustedGrossSales: round(adjustedGrossSales),
        discounts: round(totalDiscounts),
        netSales: round(netSales),
        salesTax: round(totalTax),
        surcharge: round(totalSurcharge),
        grossSales: round(grossSales),
        tips: round(totalTips),
        gratuity: 0,
        refunds: round(totalRefunds),
        totalCollected: round(totalCollected),
        commission: round(totalCommission),
      },

      payments: {
        cash: {
          count: paymentsByType.cash.count,
          amount: round(paymentsByType.cash.amount),
        },
        credit: {
          count: paymentsByType.credit.count,
          amount: round(paymentsByType.credit.amount),
          tips: round(paymentsByType.credit.tips),
          breakdown: {
            visa: { count: creditCardBreakdown.visa.count, amount: round(creditCardBreakdown.visa.amount) },
            mastercard: { count: creditCardBreakdown.mastercard.count, amount: round(creditCardBreakdown.mastercard.amount) },
            amex: { count: creditCardBreakdown.amex.count, amount: round(creditCardBreakdown.amex.amount) },
            discover: { count: creditCardBreakdown.discover.count, amount: round(creditCardBreakdown.discover.amount) },
            other: { count: creditCardBreakdown.other.count, amount: round(creditCardBreakdown.other.amount) },
          },
        },
        gift: {
          count: paymentsByType.gift.count,
          amount: round(paymentsByType.gift.amount),
        },
        houseAccount: {
          count: paymentsByType.house_account.count,
          amount: round(paymentsByType.house_account.amount),
        },
        other: {
          count: paymentsByType.other.count,
          amount: round(paymentsByType.other.amount),
        },
        totalPayments: round(totalPayments),
      },

      cash: {
        cashReceived: round(cashReceived),
        cashIn: 0,
        cashOut: 0,
        gratuity: 0,
        tipsOwed: round(cashTipsOwed),
        cashDue: round(cashDue),
      },

      revenueGroups: Object.values(revenueGroups).map(g => ({
        name: g.name,
        gross: round(g.gross),
        net: round(g.net),
        discounts: round(g.discounts),
        voids: round(g.voids),
        percentOfGross: adjustedGrossSales > 0 ? round((g.gross / adjustedGrossSales) * 100) : 0,
        percentOfNet: netSales > 0 ? round((g.net / netSales) * 100) : 0,
      })),

      salesByCategory: Object.values(salesByCategory)
        .filter(c => c.gross > 0 || c.voids > 0)
        .map(c => ({
          ...c,
          gross: round(c.gross),
          discounts: round(c.discounts),
          net: round(c.net),
          voids: round(c.voids),
          percentOfTotal: netSales > 0 ? round((c.net / netSales) * 100) : 0,
        }))
        .sort((a, b) => b.net - a.net),

      voids: {
        tickets: { count: voidedTicketCount, amount: round(voidedTicketAmount) },
        items: { count: voidedItemCount, amount: round(voidedItemAmount) },
        total: { count: voidedTicketCount + voidedItemCount, amount: round(totalVoids) },
        percentOfSales: round(voidPercentage),
        byReason: Object.entries(voidsByReason).map(([reason, data]) => ({
          reason,
          count: data.count,
          amount: round(data.amount),
        })),
      },

      discounts: {
        total: round(totalDiscounts),
        byType: Object.entries(discountsByType)
          .map(([name, data]) => ({
            name,
            count: data.count,
            amount: round(data.amount),
          }))
          .sort((a, b) => b.amount - a.amount),
      },

      // Tip shares - separates earned tips (subject to tip-out) from received tips (not subject to tip-out)
      // Migrated from legacy TipShare (Skill 273)
      tipShares: {
        // Tips earned from orders this shift (subject to tip-out calculation)
        earned: round(tipsEarned),
        // Tips given to others (tip-outs)
        given: {
          total: round(tipsGivenTotal),
          shares: tipOutsGiven.map(entry => {
            const counterparty = entry.sourceId ? counterpartyBySourceId.get(entry.sourceId) : null
            const toName = counterparty
              ? (counterparty.displayName || `${counterparty.firstName} ${counterparty.lastName}`)
              : (entry.memo || 'Unknown')
            return {
              id: entry.id,
              to: toName,
              amount: round(Math.abs(entry.amountCents) / 100),
              percentage: null, // TipOutRule percentage not stored on ledger entry
              shareType: 'role_tipout',
            }
          }),
        },
        // Tips received from others (NOT subject to tip-out - already tipped out by the giver)
        received: {
          total: round(tipsReceivedTotal),
          pending: round(tipsReceivedPending),
          collected: round(tipsReceivedCollected),
          shares: tipOutsReceived.map(entry => {
            const counterparty = entry.sourceId ? counterpartyBySourceId.get(entry.sourceId) : null
            const fromName = counterparty
              ? (counterparty.displayName || `${counterparty.firstName} ${counterparty.lastName}`)
              : (entry.memo || 'Unknown')
            return {
              id: entry.id,
              from: fromName,
              amount: round(entry.amountCents / 100),
              percentage: null, // TipOutRule percentage not stored on ledger entry
              shareType: 'role_tipout',
              status: 'collected', // All posted ledger entries are collected
            }
          }),
        },
        // Net tips = earned - given + received(collected)
        netTips: round(netTipsCalculated),
      },

      stats: {
        checks: checkCount,
        avgCheck: round(avgCheck),
        avgCheckTimeMinutes: round(avgCheckTime),
        covers: totalCovers,
        avgCover: round(avgCover),
        foodAvg: round(foodAvg),
        bevAvg: round(bevAvg),
        retailAvg: round(retailAvg),
      },
    })
  } catch (error) {
    console.error('Failed to generate employee shift report:', error)
    return NextResponse.json(
      { error: 'Failed to generate employee shift report' },
      { status: 500 }
    )
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
