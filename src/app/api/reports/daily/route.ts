import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

// GET - Generate comprehensive daily report
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const dateStr = searchParams.get('date') // YYYY-MM-DD format
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_VIEW, { soft: true })
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Parse date range (full 24-hour period in UTC)
    // For business reports, we typically want a full calendar day
    let startOfDay: Date
    let endOfDay: Date
    let date: Date

    if (dateStr) {
      // Parse as UTC date to avoid timezone issues
      startOfDay = new Date(dateStr + 'T00:00:00.000Z')
      endOfDay = new Date(dateStr + 'T23:59:59.999Z')
      date = new Date(dateStr + 'T12:00:00.000Z') // Midday for display purposes
    } else {
      // For "today", use local time boundaries
      const now = new Date()
      date = now
      startOfDay = new Date(now)
      startOfDay.setHours(0, 0, 0, 0)
      endOfDay = new Date(now)
      endOfDay.setHours(23, 59, 59, 999)
    }

    // Fetch all orders for the day
    // NOTE: 'merged' status is intentionally excluded to prevent double-counting revenue.
    // When tables are virtually combined, secondary table orders are marked as 'merged'
    // and their items are moved to the primary table's order. Only the primary order
    // (with status 'paid') should count toward revenue.
    const orders = await db.order.findMany({
      where: {
        locationId,
        createdAt: { gte: startOfDay, lte: endOfDay },
        status: { in: ['completed', 'closed', 'paid'] }, // Excludes 'merged', 'open', 'voided'
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

    // Fetch voided orders separately
    const voidedOrders = await db.order.findMany({
      where: {
        locationId,
        createdAt: { gte: startOfDay, lte: endOfDay },
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

    // Fetch void logs for the day
    const voidLogs = await db.voidLog.findMany({
      where: {
        locationId,
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
    })

    // Fetch time clock entries for labor calculation
    const timeEntries = await db.timeClockEntry.findMany({
      where: {
        locationId,
        clockIn: { gte: startOfDay, lte: endOfDay },
      },
      include: {
        employee: {
          include: {
            role: true,
          },
        },
      },
    })

    // Fetch paid in/out for the day
    const paidInOuts = await db.paidInOut.findMany({
      where: {
        locationId,
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
    })

    // Fetch gift card transactions
    const giftCardTransactions = await db.giftCardTransaction.findMany({
      where: {
        locationId,
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
    })

    // Fetch tip bank transactions for the day
    // Tips BANKED today = cash servers gave to house (for absent employees)
    const tipsBankedToday = await db.tipBank.findMany({
      where: {
        locationId,
        createdAt: { gte: startOfDay, lte: endOfDay },
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
        tipShare: {
          include: {
            fromEmployee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                displayName: true,
              },
            },
          },
        },
      },
    })

    // Tips COLLECTED today = cash house paid out to employees
    const tipsCollectedToday = await db.tipBank.findMany({
      where: {
        locationId,
        collectedAt: { gte: startOfDay, lte: endOfDay },
        status: 'collected',
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

    // Fetch ALL tip shares distributed today (for tracking who gave tips)
    const tipSharesDistributed = await db.tipShare.findMany({
      where: {
        locationId,
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
      include: {
        fromEmployee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
        toEmployee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
        rule: {
          select: {
            percentage: true,
            fromRole: { select: { name: true } },
            toRole: { select: { name: true } },
          },
        },
      },
    })

    // Fetch categories for grouping
    const categories = await db.category.findMany({
      where: { locationId },
    })

    // ============================================
    // CALCULATE REVENUE
    // ============================================

    let adjustedGrossSales = 0
    let totalDiscounts = 0
    let totalTax = 0
    let totalTaxFromInclusive = 0
    let totalTaxFromExclusive = 0
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

    // Sales by order type
    const salesByOrderType: Record<string, {
      name: string
      count: number
      gross: number
      net: number
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
      totalTaxFromInclusive += Number(order.taxFromInclusive) || 0
      totalTaxFromExclusive += Number(order.taxFromExclusive) || 0
      totalTips += orderTip
      totalCommission += orderCommission

      // Track by order type
      const orderTypeName = order.orderType || 'Unknown'
      if (!salesByOrderType[orderTypeName]) {
        salesByOrderType[orderTypeName] = {
          name: orderTypeName,
          count: 0,
          gross: 0,
          net: 0,
        }
      }
      salesByOrderType[orderTypeName].count++
      salesByOrderType[orderTypeName].gross += orderSubtotal + orderTax + totalSurcharge
      salesByOrderType[orderTypeName].net += orderSubtotal - orderDiscount

      // Track by category
      order.items.forEach(item => {
        const itemTotal = Number(item.price) * item.quantity
        const categoryId = item.menuItem?.category?.id

        if (categoryId && salesByCategory[categoryId]) {
          salesByCategory[categoryId].units += item.quantity
          salesByCategory[categoryId].gross += itemTotal
        }
      })

      // Distribute discounts to categories (proportionally)
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

    // Back out hidden tax from inclusive items for accurate gross sales
    // adjustedGrossSales (subtotal) includes hidden tax for inclusive items
    const preTaxGrossSales = adjustedGrossSales - totalTaxFromInclusive
    const netSales = preTaxGrossSales - totalDiscounts
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

          // Track by card type
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

    let cashIn = 0
    let cashOut = 0

    paidInOuts.forEach(pio => {
      const amount = Number(pio.amount) || 0
      if (pio.type === 'in') {
        cashIn += amount
      } else {
        cashOut += amount
      }
    })

    const cashReceived = paymentsByType.cash.amount
    const cashTipsOut = paymentsByType.credit.tips // Tips paid out in cash from credit card tips
    const cashDue = cashReceived + cashIn - cashOut

    // ============================================
    // VOIDS & REFUNDS
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
    // LABOR SUMMARY
    // ============================================

    let fohHours = 0
    let fohCost = 0
    let bohHours = 0
    let bohCost = 0

    timeEntries.forEach(entry => {
      if (!entry.clockOut) return

      const hours =
        (entry.clockOut.getTime() - entry.clockIn.getTime()) / (1000 * 60 * 60)
      const breakHours = (entry.breakMinutes || 0) / 60
      const netHours = Math.max(0, hours - breakHours)
      const hourlyRate = Number(entry.employee.hourlyRate) || 0
      const cost = netHours * hourlyRate

      // Determine FOH vs BOH by role permissions or name
      const roleName = (entry.employee.role?.name || '').toLowerCase()
      const isBOH =
        roleName.includes('cook') ||
        roleName.includes('chef') ||
        roleName.includes('kitchen') ||
        roleName.includes('prep') ||
        roleName.includes('dish')

      if (isBOH) {
        bohHours += netHours
        bohCost += cost
      } else {
        fohHours += netHours
        fohCost += cost
      }
    })

    const totalLaborHours = fohHours + bohHours
    const totalLaborCost = fohCost + bohCost
    const laborPercentage = netSales > 0 ? (totalLaborCost / netSales) * 100 : 0

    // ============================================
    // GIFT CARD SUMMARY
    // ============================================

    let giftCardLoads = 0
    let giftCardRedemptions = 0

    giftCardTransactions.forEach(txn => {
      const amount = Number(txn.amount) || 0
      if (txn.type === 'load' || txn.type === 'sale') {
        giftCardLoads += amount
      } else if (txn.type === 'redeem' || txn.type === 'redemption') {
        giftCardRedemptions += amount
      }
    })

    // ============================================
    // TIP BANK SUMMARY
    // When servers tip out to absent employees, the house holds the cash
    // ============================================

    // Tips banked = cash IN to house (servers gave to house for absent employees)
    const tipsBankedIn = tipsBankedToday.reduce((sum, tb) => sum + Number(tb.amount), 0)

    // Tips collected = cash OUT from house (house paid employees who collected)
    const tipsCollectedOut = tipsCollectedToday.reduce((sum, tb) => sum + Number(tb.amount), 0)

    // Net tip bank change for the day
    const tipBankNetChange = tipsBankedIn - tipsCollectedOut

    // Group tip shares by the employee who GAVE them
    const tipSharesByGiver: Record<string, {
      employeeId: string
      employeeName: string
      totalGiven: number
      shares: Array<{
        toEmployee: string
        amount: number
        shareType: string
        ruleName: string | null
        percentage: number | null
        status: string
      }>
    }> = {}

    tipSharesDistributed.forEach(share => {
      const giverId = share.fromEmployee.id
      const giverName = share.fromEmployee.displayName ||
        `${share.fromEmployee.firstName} ${share.fromEmployee.lastName}`
      const toName = share.toEmployee.displayName ||
        `${share.toEmployee.firstName} ${share.toEmployee.lastName}`

      if (!tipSharesByGiver[giverId]) {
        tipSharesByGiver[giverId] = {
          employeeId: giverId,
          employeeName: giverName,
          totalGiven: 0,
          shares: [],
        }
      }

      tipSharesByGiver[giverId].totalGiven += Number(share.amount)
      tipSharesByGiver[giverId].shares.push({
        toEmployee: toName,
        amount: Number(share.amount),
        shareType: share.shareType,
        ruleName: share.rule
          ? `${share.rule.fromRole.name} → ${share.rule.toRole.name}`
          : null,
        percentage: share.rule ? Number(share.rule.percentage) : null,
        status: share.status,
      })
    })

    const totalTipSharesDistributed = tipSharesDistributed.reduce(
      (sum, s) => sum + Number(s.amount), 0
    )

    // ============================================
    // STATS
    // ============================================

    const checkCount = orders.length
    const avgCheck = checkCount > 0 ? totalCollected / checkCount : 0

    // Calculate covers (guests)
    let totalCovers = 0
    orders.forEach(order => {
      totalCovers += order.guestCount || 1
    })
    const avgCover = totalCovers > 0 ? totalCollected / totalCovers : 0

    // Calculate average check time
    let totalCheckTime = 0
    let checkTimeCount = 0
    orders.forEach(order => {
      if (order.closedAt && order.createdAt) {
        const minutes =
          (order.closedAt.getTime() - order.createdAt.getTime()) / (1000 * 60)
        totalCheckTime += minutes
        checkTimeCount++
      }
    })
    const avgCheckTime = checkTimeCount > 0 ? totalCheckTime / checkTimeCount : 0

    // Food, Bev, Retail averages
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
    // BUSINESS COSTS (CC Tip Fees)
    // ============================================

    const ccTipFees = await db.tipTransaction.aggregate({
      _sum: { ccFeeAmountCents: true },
      _count: true,
      where: {
        locationId,
        collectedAt: { gte: startOfDay, lte: endOfDay },
        ccFeeAmountCents: { gt: 0 },
        deletedAt: null,
      },
    })

    // ============================================
    // BUILD RESPONSE
    // ============================================

    return NextResponse.json({
      reportDate: date.toISOString().split('T')[0],
      generatedAt: new Date().toISOString(),

      revenue: {
        adjustedGrossSales: round(preTaxGrossSales),
        discounts: round(totalDiscounts),
        netSales: round(netSales),
        salesTax: round(totalTax),
        taxFromInclusive: round(totalTaxFromInclusive),
        taxFromExclusive: round(totalTaxFromExclusive),
        surcharge: round(totalSurcharge),
        grossSales: round(grossSales),
        tips: round(totalTips),
        gratuity: 0, // Auto-gratuity not tracked separately
        refunds: round(totalRefunds),
        giftCardLoads: round(giftCardLoads),
        totalCollected: round(totalCollected),
        commission: round(totalCommission),
      },

      payments: {
        cash: {
          count: paymentsByType.cash.count,
          amount: round(paymentsByType.cash.amount),
          tips: round(paymentsByType.cash.tips),
        },
        credit: {
          count: paymentsByType.credit.count,
          amount: round(paymentsByType.credit.amount),
          tips: round(paymentsByType.credit.tips),
          breakdown: {
            visa: creditCardBreakdown.visa,
            mastercard: creditCardBreakdown.mastercard,
            amex: creditCardBreakdown.amex,
            discover: creditCardBreakdown.discover,
            other: creditCardBreakdown.other,
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
        cashIn: round(cashIn),
        cashOut: round(cashOut),
        tipsOut: round(cashTipsOut),
        // Tip shares - ALL go to payroll, house keeps the cash
        tipSharesIn: round(totalTipSharesDistributed),        // Cash IN: servers give ALL tip-outs to house
        // Cash due = sales cash + ALL tip shares (house holds for payroll)
        cashDue: round(cashDue + totalTipSharesDistributed),
      },

      paidInOut: {
        paidIn: round(cashIn),
        paidOut: round(cashOut),
        net: round(cashIn - cashOut),
      },

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

      salesByOrderType: Object.values(salesByOrderType)
        .map(t => ({
          ...t,
          gross: round(t.gross),
          net: round(t.net),
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

      labor: {
        frontOfHouse: {
          hours: round(fohHours),
          cost: round(fohCost),
          percentOfLabor: totalLaborCost > 0 ? round((fohCost / totalLaborCost) * 100) : 0,
        },
        backOfHouse: {
          hours: round(bohHours),
          cost: round(bohCost),
          percentOfLabor: totalLaborCost > 0 ? round((bohCost / totalLaborCost) * 100) : 0,
        },
        total: {
          hours: round(totalLaborHours),
          cost: round(totalLaborCost),
          percentOfSales: round(laborPercentage),
        },
      },

      giftCards: {
        loads: round(giftCardLoads),
        redemptions: round(giftCardRedemptions),
        netLiability: round(giftCardLoads - giftCardRedemptions),
      },

      // Tip Shares - All tip distributions for the day, by employee who gave
      tipShares: {
        totalDistributed: round(totalTipSharesDistributed),
        byEmployee: Object.values(tipSharesByGiver).map(giver => ({
          employeeId: giver.employeeId,
          employeeName: giver.employeeName,
          totalGiven: round(giver.totalGiven),
          shares: giver.shares.map(s => ({
            ...s,
            amount: round(s.amount),
          })),
        })).sort((a, b) => b.totalGiven - a.totalGiven),
      },

      // All tip shares go to payroll - house holds the cash
      // tipBank tracks legacy banked entries (can be removed once migrated)
      tipBank: {
        total: round(totalTipSharesDistributed),  // Total tip shares for payroll
        pendingPayroll: round(totalTipSharesDistributed), // All goes to payroll
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

      businessCosts: {
        ccTipFees: round((ccTipFees._sum.ccFeeAmountCents || 0) / 100),
        ccTipFeeTransactions: ccTipFees._count || 0,
      },
    })
  } catch (error) {
    console.error('Failed to generate daily report:', error)
    return NextResponse.json(
      { error: 'Failed to generate daily report', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
