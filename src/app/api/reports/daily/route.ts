import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { REVENUE_ORDER_STATUSES } from '@/lib/constants'
import { getBusinessDayRange, getCurrentBusinessDay } from '@/lib/business-day'
import { parseSettings, getPricingProgram } from '@/lib/settings'
import { getLocationSettings, getLocationTimezone } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { checkReportRateLimit } from '@/lib/report-rate-limiter'
import {
  getRevenueSummary,
  getSalesByOrderType,
  getCategorySales,
  getCategoryVoids,
  getPaymentSummary,
  getDiscountSummary,
  getWeightBasedSales,
  getEntertainmentSummary,
  getSurchargeBase,
  getVoidLogs,
  getPaidInOut as getDailyPaidInOut,
  getGiftCardTransactions,
  getCategories,
  getCCTipFees,
  getTipsBankedInRange,
  getTipsCollectedInRange,
  getTipSharesDistributedInRange,
  getTimeClockEntries,
  type BusinessDayRange,
} from '@/lib/query-services'
import { err, ok } from '@/lib/api-response'
import {
  round,
  processPaymentSummary,
  buildCategoryMap,
  processVoidLogs,
  processLaborEntries,
  processGiftCardTransactions,
  processTipShares,
  processCashReconciliation,
  computeStats,
  processWeightSales,
} from '@/lib/reports/daily-calculations'

// ============================================================
// SQL-AGGREGATE DAILY REPORT (replaces in-memory iteration)
// ============================================================
// The old implementation fetched up to 10,000 orders with full
// includes and iterated them in JS. This version runs ~10 SQL
// aggregate queries in parallel — 10-20x faster, constant memory.
//
// Legacy mode (?legacy=true) preserves the old path for debugging.
// ============================================================

// GET - Generate comprehensive daily report
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const dateStr = searchParams.get('date') // YYYY-MM-DD format
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')
    const useLegacy = searchParams.get('legacy') === 'true'

    if (!locationId) {
      return err('Location ID required')
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_VIEW)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    const rateCheck = checkReportRateLimit(requestingEmployeeId || 'anonymous')
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: 'Rate limited', retryAfter: rateCheck.retryAfterSeconds }, { status: 429 })
    }

    // Fetch location settings from cache for business day boundaries
    const locationSettings = parseSettings(await getLocationSettings(locationId))
    const dayStartTime = locationSettings.businessDay.dayStartTime
    // TZ-FIX: Use venue timezone so Vercel (UTC) computes correct date boundaries
    const timezone = await getLocationTimezone(locationId)

    // Parse date range using business day boundaries
    let startOfDay: Date
    let endOfDay: Date
    let date: Date

    if (dateStr) {
      const range = getBusinessDayRange(dateStr, dayStartTime, timezone)
      startOfDay = range.start
      endOfDay = range.end
      date = new Date(dateStr + 'T12:00:00')
    } else {
      const current = getCurrentBusinessDay(dayStartTime, timezone)
      startOfDay = current.start
      endOfDay = current.end
      date = new Date(current.date + 'T12:00:00')
    }

    // ── Legacy path (fallback) ────────────────────────────────
    if (useLegacy) {
      return legacyReport(locationId, startOfDay, endOfDay, date, locationSettings)
    }

    // ── SQL-Aggregate path ────────────────────────────────────
    const range: BusinessDayRange = { start: startOfDay, end: endOfDay }
    const pricingProgramForSurcharge = getPricingProgram(locationSettings)
    const needsSurcharge = pricingProgramForSurcharge.model === 'surcharge'
      && pricingProgramForSurcharge.enabled
      && !!pricingProgramForSurcharge.surchargePercent

    const [
      revenueSummary, orderTypeSummary, categorySales, categoryVoids,
      paymentSummaryRows, discountSummary, weightSummary, _statsSummary,
      surchargeBase, voidLogs, timeEntries, paidInOuts,
      giftCardTransactions, tipsBankedToday, tipsCollectedToday,
      tipSharesDistributed, categories, ccTipFeesResult,
      entertainmentSummary, refundAggregate,
    ] = await Promise.all([
      getRevenueSummary(locationId, range),
      getSalesByOrderType(locationId, range),
      getCategorySales(locationId, range).then(r => r.data),
      getCategoryVoids(locationId, range),
      getPaymentSummary(locationId, range),
      getDiscountSummary(locationId, range),
      getWeightBasedSales(locationId, range),
      Promise.resolve(null),
      needsSurcharge ? getSurchargeBase(locationId, range).then(r => r.data) : Promise.resolve(0),
      getVoidLogs(locationId, range),
      getTimeClockEntries(locationId, range),
      getDailyPaidInOut(locationId, range),
      getGiftCardTransactions(locationId, range),
      getTipsBankedInRange(locationId, range),
      getTipsCollectedInRange(locationId, range),
      getTipSharesDistributedInRange(locationId, range),
      getCategories(locationId),
      getCCTipFees(locationId, range),
      getEntertainmentSummary(locationId, range),
      db.refundLog.aggregate({
        where: {
          locationId,
          deletedAt: null,
          createdAt: { gte: range.start, lte: range.end },
        },
        _sum: { refundAmount: true },
      }),
    ])

    // ── Process aggregate results ─────────────────────────────
    const rev = revenueSummary
    const adjustedGrossSales = Number(rev.subtotal) || 0
    const totalTax = Number(rev.tax_total) || 0
    const totalTaxFromInclusive = Number(rev.tax_from_inclusive) || 0
    const totalTaxFromExclusive = Number(rev.tax_from_exclusive) || 0
    const totalTips = Number(rev.tip_total) || 0
    const totalDiscounts = Number(rev.discount_total) || 0
    const totalCommission = Number(rev.commission_total) || 0
    const totalDonations = Number(rev.donation_total) || 0
    const checkCount = Number(rev.order_count) || 0
    const totalCovers = Number(rev.guest_count) || 0
    const totalRefunds = Number(refundAggregate._sum.refundAmount) || 0
    const totalCheckTimeMinutes = Number(rev.total_check_time_minutes) || 0
    const closedOrderCount = Number(rev.closed_count) || 0

    // Surcharge
    const pricingProgram = getPricingProgram(locationSettings)
    let totalSurcharge = 0
    if (pricingProgram.model === 'surcharge' && pricingProgram.enabled && pricingProgram.surchargePercent) {
      totalSurcharge = Math.round(Number(surchargeBase) * pricingProgram.surchargePercent) / 100
    }

    // Revenue derivations
    const preTaxGrossSales = adjustedGrossSales - totalTaxFromInclusive
    const netSales = preTaxGrossSales - totalDiscounts
    const grossSales = netSales + totalTax + totalSurcharge
    const totalCollected = grossSales + totalTips - totalRefunds

    // ── Delegate to calculation helpers ───────────────────────
    const payments = processPaymentSummary(paymentSummaryRows)

    const inclTaxRateRaw = locationSettings.tax?.inclusiveTaxRate
    const catInclRate = (inclTaxRateRaw != null && Number.isFinite(inclTaxRateRaw) && inclTaxRateRaw > 0)
      ? inclTaxRateRaw / 100 : 0
    const catMap = buildCategoryMap(categories, categorySales, categoryVoids, catInclRate)

    const salesByOrderType = orderTypeSummary.map(row => ({
      name: row.order_type,
      count: Number(row.count) || 0,
      gross: Number(row.gross) || 0,
      net: Number(row.net) || 0,
    }))

    const cash = processCashReconciliation(payments.paymentsByType.cash.amount, tipsCollectedToday, paidInOuts)
    const voids = processVoidLogs(voidLogs, adjustedGrossSales)
    const discountsByType = discountSummary.map(row => ({
      name: row.discount_name, count: Number(row.count) || 0, amount: Number(row.total) || 0,
    }))
    const labor = processLaborEntries(timeEntries, netSales)
    const giftCards = processGiftCardTransactions(giftCardTransactions)
    const tipShares = processTipShares(tipSharesDistributed)
    const tipsBankedIn = tipsBankedToday.reduce((sum, e) => sum + Number(e.amountCents) / 100, 0)
    const tipsCollectedOut = tipsCollectedToday.reduce((sum, e) => sum + Math.abs(Number(e.amountCents)) / 100, 0)
    const weight = processWeightSales(weightSummary)
    const stats = computeStats(checkCount, totalCovers, closedOrderCount, totalCheckTimeMinutes, totalCollected, catMap)

    // ── Build response (identical shape to legacy) ────────────
    return ok({
      reportDate: date.toISOString().split('T')[0],
      generatedAt: new Date().toISOString(),
      revenue: {
        adjustedGrossSales: round(preTaxGrossSales), discounts: round(totalDiscounts),
        netSales: round(netSales), salesTax: round(totalTax),
        taxFromInclusive: round(totalTaxFromInclusive), taxFromExclusive: round(totalTaxFromExclusive),
        surcharge: round(totalSurcharge), grossSales: round(grossSales),
        tips: round(totalTips), gratuity: 0, refunds: round(totalRefunds),
        giftCardLoads: round(giftCards.giftCardLoads),
        roundingAdjustments: round(payments.totalRoundingAdjustments),
        totalCollected: round(totalCollected),
        commission: round(totalCommission), donations: round(totalDonations),
      },
      payments: {
        cash: { count: payments.paymentsByType.cash.count, amount: round(payments.paymentsByType.cash.amount), tips: round(payments.paymentsByType.cash.tips) },
        credit: {
          count: payments.paymentsByType.credit.count, amount: round(payments.paymentsByType.credit.amount), tips: round(payments.paymentsByType.credit.tips),
          breakdown: {
            visa: payments.creditCardBreakdown.visa, mastercard: payments.creditCardBreakdown.mastercard,
            amex: payments.creditCardBreakdown.amex, discover: payments.creditCardBreakdown.discover, other: payments.creditCardBreakdown.other,
          },
        },
        debit: { count: payments.paymentsByType.debit.count, amount: round(payments.paymentsByType.debit.amount), tips: round(payments.paymentsByType.debit.tips) },
        gift: { count: payments.paymentsByType.gift.count, amount: round(payments.paymentsByType.gift.amount) },
        houseAccount: { count: payments.paymentsByType.house_account.count, amount: round(payments.paymentsByType.house_account.amount) },
        roomCharge: { count: payments.paymentsByType.room_charge.count, amount: round(payments.paymentsByType.room_charge.amount), tips: round(payments.paymentsByType.room_charge.tips) },
        loyaltyPoints: { count: payments.paymentsByType.loyalty_points.count, amount: round(payments.paymentsByType.loyalty_points.amount) },
        other: { count: payments.paymentsByType.other.count, amount: round(payments.paymentsByType.other.amount) },
        totalPayments: round(payments.totalPayments),
      },
      cash: {
        cashReceived: round(cash.cashReceived), cashIn: round(cash.cashIn), cashOut: round(cash.cashOut),
        tipsOut: round(cash.cashTipsOut), roundingAdjustments: round(payments.totalRoundingAdjustments),
        tipSharesIn: round(tipShares.totalTipSharesDistributed),
        cashDue: round(cash.cashDue + tipShares.totalTipSharesDistributed + payments.totalRoundingAdjustments),
      },
      paidInOut: { paidIn: round(cash.cashIn), paidOut: round(cash.cashOut), net: round(cash.cashIn - cash.cashOut) },
      salesByCategory: Object.values(catMap)
        .filter(c => c.gross > 0 || c.voids > 0)
        .map(c => ({ ...c, gross: round(c.gross), discounts: round(c.discounts), net: round(c.net), voids: round(c.voids), percentOfTotal: netSales > 0 ? round((c.net / netSales) * 100) : 0 }))
        .sort((a, b) => b.net - a.net),
      salesByOrderType: salesByOrderType.map(t => ({ ...t, gross: round(t.gross), net: round(t.net) })).sort((a, b) => b.net - a.net),
      voids: {
        tickets: { count: voids.voidedTicketCount, amount: round(voids.voidedTicketAmount) },
        items: { count: voids.voidedItemCount, amount: round(voids.voidedItemAmount) },
        total: { count: voids.voidedTicketCount + voids.voidedItemCount, amount: round(voids.totalVoids) },
        percentOfSales: round(voids.voidPercentage),
        byReason: Object.entries(voids.voidsByReason).map(([reason, data]) => ({ reason, count: data.count, amount: round(data.amount) })),
      },
      discounts: {
        total: round(totalDiscounts),
        byType: discountsByType.map(d => ({ name: d.name, count: d.count, amount: round(d.amount) })).sort((a, b) => b.amount - a.amount),
      },
      labor: {
        frontOfHouse: { hours: round(labor.fohHours), cost: round(labor.fohCost), percentOfLabor: labor.totalLaborCost > 0 ? round((labor.fohCost / labor.totalLaborCost) * 100) : 0 },
        backOfHouse: { hours: round(labor.bohHours), cost: round(labor.bohCost), percentOfLabor: labor.totalLaborCost > 0 ? round((labor.bohCost / labor.totalLaborCost) * 100) : 0 },
        total: { hours: round(labor.totalLaborHours), cost: round(labor.totalLaborCost), percentOfSales: round(labor.laborPercentage) },
      },
      giftCards: { loads: round(giftCards.giftCardLoads), redemptions: round(giftCards.giftCardRedemptions), netLiability: round(giftCards.giftCardLoads - giftCards.giftCardRedemptions) },
      tipShares: {
        totalDistributed: round(tipShares.totalTipSharesDistributed),
        byEmployee: Object.values(tipShares.tipSharesByGiver).map(g => ({
          employeeId: g.employeeId, employeeName: g.employeeName, totalGiven: round(g.totalGiven),
          shares: g.shares.map(s => ({ ...s, amount: round(s.amount) })),
        })).sort((a, b) => b.totalGiven - a.totalGiven),
      },
      tipBank: { total: round(tipShares.totalTipSharesDistributed), pendingPayroll: round(tipShares.totalTipSharesDistributed) },
      weightBasedSales: weight.weightBasedItemCount > 0 ? {
        revenue: round(weight.weightBasedRevenue), itemCount: weight.weightBasedItemCount,
        totalWeight: Object.entries(weight.weightByUnit).map(([unit, w]) => ({ unit, weight: round(w) })),
      } : null,
      stats: {
        checks: stats.checkCount, avgCheck: round(stats.avgCheck), avgCheckTimeMinutes: round(stats.avgCheckTime),
        covers: stats.totalCovers, avgCover: round(stats.avgCover),
        foodAvg: round(stats.foodAvg), bevAvg: round(stats.bevAvg), retailAvg: round(stats.retailAvg),
      },
      businessCosts: { ccTipFees: round(ccTipFeesResult.totalCents / 100), ccTipFeeTransactions: ccTipFeesResult.transactionCount },
      entertainment: (() => {
        const ent = entertainmentSummary
        if (!ent || Number(ent.session_count) === 0) return null
        const sessions = Number(ent.session_count) || 0
        const revenue = Number(ent.revenue) || 0
        const totalMin = Number(ent.total_minutes) || 0
        return { revenue: round(revenue), sessions, averageSessionMinutes: sessions > 0 ? round(totalMin / sessions) : 0, topItem: ent.top_item_name || null }
      })(),
    })
  } catch (error) {
    console.error('Failed to generate daily report:', error)
    return err('Failed to generate daily report', 500)
  }
})

// ============================================================
// LEGACY PATH — full in-memory processing (fallback via ?legacy=true)
// ============================================================

async function legacyReport(
  locationId: string,
  startOfDay: Date,
  endOfDay: Date,
  date: Date,
  locationSettings: ReturnType<typeof parseSettings>,
) {
  const [
    orders, voidedOrders, voidLogs, timeEntries, paidInOuts,
    giftCardTransactions, tipsBankedToday, tipsCollectedToday,
    tipSharesDistributed, categories, legacyRefundAggregate,
  ] = await Promise.all([
    db.order.findMany({
      where: {
        locationId, deletedAt: null,
        status: { in: [...REVENUE_ORDER_STATUSES] },
        NOT: { splitOrders: { some: {} } },
        OR: [
          { businessDayDate: { gte: startOfDay, lte: endOfDay } },
          { businessDayDate: null, createdAt: { gte: startOfDay, lte: endOfDay } },
        ],
      },
      take: 10000,
      include: {
        items: {
          where: { deletedAt: null },
          include: {
            modifiers: { select: { price: true } },
            menuItem: { select: { category: { select: { id: true } } } },
          },
        },
        payments: {
          where: { status: 'completed' },
          select: { paymentMethod: true, amount: true, tipAmount: true, roundingAdjustment: true, cardBrand: true },
        },
        discounts: { select: { name: true, amount: true, discountRule: { select: { name: true } } } },
        employee: { select: { id: true, firstName: true, lastName: true, displayName: true } },
      },
    }),
    db.order.findMany({
      where: {
        locationId, deletedAt: null, status: 'voided',
        OR: [
          { businessDayDate: { gte: startOfDay, lte: endOfDay } },
          { businessDayDate: null, createdAt: { gte: startOfDay, lte: endOfDay } },
        ],
      },
      take: 10000,
      include: { items: { where: { deletedAt: null }, include: { menuItem: { select: { category: { select: { id: true } } } } } } },
    }),
    db.voidLog.findMany({ where: { locationId, createdAt: { gte: startOfDay, lte: endOfDay } }, take: 10000 }),
    db.timeClockEntry.findMany({
      where: { locationId, clockIn: { gte: startOfDay, lte: endOfDay } }, take: 10000,
      include: { employee: { select: { hourlyRate: true, role: { select: { name: true } } } } },
    }),
    db.paidInOut.findMany({ where: { locationId, createdAt: { gte: startOfDay, lte: endOfDay } }, take: 10000 }),
    db.giftCardTransaction.findMany({ where: { locationId, createdAt: { gte: startOfDay, lte: endOfDay } }, take: 10000 }),
    db.tipLedgerEntry.findMany({
      where: { locationId, type: 'CREDIT', sourceType: { in: ['DIRECT_TIP', 'TIP_GROUP'] }, deletedAt: null, createdAt: { gte: startOfDay, lte: endOfDay } },
      take: 10000, include: { employee: { select: { id: true, firstName: true, lastName: true, displayName: true } } },
    }),
    db.tipLedgerEntry.findMany({
      where: { locationId, type: 'DEBIT', sourceType: { in: ['PAYOUT_CASH', 'PAYOUT_PAYROLL'] }, deletedAt: null, createdAt: { gte: startOfDay, lte: endOfDay } },
      take: 10000, include: { employee: { select: { id: true, firstName: true, lastName: true, displayName: true } } },
    }),
    db.tipLedgerEntry.findMany({
      where: { locationId, sourceType: { in: ['ROLE_TIPOUT', 'MANUAL_TRANSFER'] }, deletedAt: null, createdAt: { gte: startOfDay, lte: endOfDay } },
      take: 10000, include: { employee: { select: { id: true, firstName: true, lastName: true, displayName: true } } },
    }),
    db.category.findMany({ where: { locationId, deletedAt: null }, select: { id: true, name: true, categoryType: true } }),
    db.refundLog.aggregate({ where: { locationId, deletedAt: null, createdAt: { gte: startOfDay, lte: endOfDay } }, _sum: { refundAmount: true } }),
  ])

  // ── Calculate Revenue ─────────────────────────────────────
  let adjustedGrossSales = 0, totalDiscounts = 0, totalTax = 0
  let totalTaxFromInclusive = 0, totalTaxFromExclusive = 0
  let totalSurcharge = 0, totalTips = 0, totalCommission = 0
  const totalRefunds = Number(legacyRefundAggregate._sum.refundAmount) || 0

  const salesByCategory: Record<string, { name: string; categoryType: string; units: number; gross: number; discounts: number; net: number; voids: number }> = {}
  const salesByOrderType: Record<string, { name: string; count: number; gross: number; net: number }> = {}

  categories.forEach(cat => {
    salesByCategory[cat.id] = { name: cat.name, categoryType: cat.categoryType || 'food', units: 0, gross: 0, discounts: 0, net: 0, voids: 0 }
  })

  const pricingProgram = getPricingProgram(locationSettings)
  const orderSurcharges = new Map<string, number>()
  if (pricingProgram.model === 'surcharge' && pricingProgram.enabled && pricingProgram.surchargePercent) {
    const pct = pricingProgram.surchargePercent
    for (const order of orders) {
      const hasCardPayment = order.payments.some(p => { const m = (p.paymentMethod || '').toLowerCase(); return m === 'credit' || m === 'card' })
      if (hasCardPayment) orderSurcharges.set(order.id, Math.round((Number(order.subtotal) || 0) * pct) / 100)
    }
  }

  let weightBasedRevenue = 0, weightBasedItemCount = 0
  const weightByUnit: Record<string, number> = {}

  orders.forEach(order => {
    const orderSubtotal = Number(order.subtotal) || 0
    const orderTax = Number(order.taxTotal) || 0
    const orderTip = Number(order.tipTotal) || 0
    const orderDiscount = Number(order.discountTotal) || 0
    const orderCommission = Number(order.commissionTotal) || 0
    const orderSurcharge = orderSurcharges.get(order.id) || 0

    adjustedGrossSales += orderSubtotal; totalDiscounts += orderDiscount
    totalTax += orderTax; totalTaxFromInclusive += Number(order.taxFromInclusive) || 0
    totalTaxFromExclusive += Number(order.taxFromExclusive) || 0
    totalSurcharge += orderSurcharge; totalTips += orderTip; totalCommission += orderCommission

    const orderTypeName = order.orderType || 'Unknown'
    if (!salesByOrderType[orderTypeName]) salesByOrderType[orderTypeName] = { name: orderTypeName, count: 0, gross: 0, net: 0 }
    salesByOrderType[orderTypeName].count++
    salesByOrderType[orderTypeName].gross += orderSubtotal + orderTax + orderSurcharge
    salesByOrderType[orderTypeName].net += orderSubtotal - orderDiscount

    order.items.filter(item => item.status !== 'voided' && item.status !== 'comped').forEach(item => {
      const itemBaseTotal = Number(item.price) * item.quantity
      const modifierTotal = (item.modifiers || []).reduce((sum: number, mod: { price: any }) => sum + (Number(mod.price) || 0), 0)
      const itemTotal = itemBaseTotal + modifierTotal
      const categoryId = item.menuItem?.category?.id
      if (categoryId && salesByCategory[categoryId]) { salesByCategory[categoryId].units += item.quantity; salesByCategory[categoryId].gross += itemTotal }
      if (item.soldByWeight && item.weight) {
        weightBasedRevenue += Number(item.itemTotal); weightBasedItemCount += item.quantity
        const unit = item.weightUnit || 'lb'; weightByUnit[unit] = (weightByUnit[unit] || 0) + Number(item.weight) * item.quantity
      }
    })

    if (orderDiscount > 0 && orderSubtotal > 0) {
      order.items.filter(item => item.status !== 'voided' && item.status !== 'comped').forEach(item => {
        const itemTotal = Number(item.price) * item.quantity
        const itemDiscountShare = (itemTotal / orderSubtotal) * orderDiscount
        const categoryId = item.menuItem?.category?.id
        if (categoryId && salesByCategory[categoryId]) salesByCategory[categoryId].discounts += itemDiscountShare
      })
    }
  })

  Object.values(salesByCategory).forEach(cat => { cat.net = cat.gross - cat.discounts })

  voidedOrders.forEach(order => {
    order.items.forEach(item => {
      const itemTotal = Number(item.price) * item.quantity
      const categoryId = item.menuItem?.category?.id
      if (categoryId && salesByCategory[categoryId]) salesByCategory[categoryId].voids += itemTotal
    })
  })

  const preTaxGrossSales = adjustedGrossSales - totalTaxFromInclusive
  const netSales = preTaxGrossSales - totalDiscounts
  const grossSales = netSales + totalTax + totalSurcharge
  const totalCollected = grossSales + totalTips - totalRefunds

  // ── Delegate to helpers ───────────────────────────────────
  const voidsResult = processVoidLogs(voidLogs, adjustedGrossSales)
  const laborResult = processLaborEntries(timeEntries, netSales)
  const gcResult = processGiftCardTransactions(giftCardTransactions)
  const tipShareResult = processTipShares(tipSharesDistributed)
  const cashResult = processCashReconciliation(0, tipsCollectedToday, paidInOuts) // cash amount calculated below

  // Legacy payment processing (per-order iteration)
  let totalRoundingAdjustments = 0
  const paymentsByType: Record<string, { count: number; amount: number; tips: number }> = {
    cash: { count: 0, amount: 0, tips: 0 }, credit: { count: 0, amount: 0, tips: 0 },
    debit: { count: 0, amount: 0, tips: 0 }, gift: { count: 0, amount: 0, tips: 0 },
    house_account: { count: 0, amount: 0, tips: 0 }, room_charge: { count: 0, amount: 0, tips: 0 },
    loyalty_points: { count: 0, amount: 0, tips: 0 }, other: { count: 0, amount: 0, tips: 0 },
  }
  const creditCardBreakdown: Record<string, { count: number; amount: number }> = {
    visa: { count: 0, amount: 0 }, mastercard: { count: 0, amount: 0 },
    amex: { count: 0, amount: 0 }, discover: { count: 0, amount: 0 }, other: { count: 0, amount: 0 },
  }

  orders.forEach(order => {
    order.payments.forEach(payment => {
      const pt = (payment.paymentMethod || 'other').toLowerCase()
      const amount = Number(payment.amount) || 0
      const tip = Number(payment.tipAmount) || 0
      const rounding = Number(payment.roundingAdjustment) || 0
      if (rounding !== 0) totalRoundingAdjustments += rounding

      if (pt === 'cash') { paymentsByType.cash.count++; paymentsByType.cash.amount += amount; paymentsByType.cash.tips += tip }
      else if (pt === 'credit' || pt === 'card') {
        paymentsByType.credit.count++; paymentsByType.credit.amount += amount; paymentsByType.credit.tips += tip
        const ct = (payment.cardBrand || 'other').toLowerCase()
        if (ct.includes('visa')) { creditCardBreakdown.visa.count++; creditCardBreakdown.visa.amount += amount }
        else if (ct.includes('master')) { creditCardBreakdown.mastercard.count++; creditCardBreakdown.mastercard.amount += amount }
        else if (ct.includes('amex') || ct.includes('american')) { creditCardBreakdown.amex.count++; creditCardBreakdown.amex.amount += amount }
        else if (ct.includes('discover')) { creditCardBreakdown.discover.count++; creditCardBreakdown.discover.amount += amount }
        else { creditCardBreakdown.other.count++; creditCardBreakdown.other.amount += amount }
      }
      else if (pt === 'debit') { paymentsByType.debit.count++; paymentsByType.debit.amount += amount; paymentsByType.debit.tips += tip }
      else if (pt === 'gift' || pt === 'gift_card') { paymentsByType.gift.count++; paymentsByType.gift.amount += amount; paymentsByType.gift.tips += tip }
      else if (pt === 'house_account') { paymentsByType.house_account.count++; paymentsByType.house_account.amount += amount }
      else if (pt === 'room_charge') { paymentsByType.room_charge.count++; paymentsByType.room_charge.amount += amount; paymentsByType.room_charge.tips += tip }
      else if (pt === 'loyalty_points' || pt === 'loyalty') { paymentsByType.loyalty_points.count++; paymentsByType.loyalty_points.amount += amount }
      else { paymentsByType.other.count++; paymentsByType.other.amount += amount; paymentsByType.other.tips += tip }
    })
  })

  const totalPayments = Object.values(paymentsByType).reduce((sum, p) => sum + p.amount, 0)

  // Legacy cash reconciliation
  const cashReceived = paymentsByType.cash.amount
  const cashDue = cashReceived + cashResult.cashIn - cashResult.cashOut - cashResult.cashTipsOut

  // Discount breakdown
  const discountsByType: Record<string, { count: number; amount: number }> = {}
  orders.forEach(order => {
    order.discounts.forEach(discount => {
      const name = discount.discountRule?.name || discount.name || 'Unknown'
      const amount = Number(discount.amount) || 0
      if (!discountsByType[name]) discountsByType[name] = { count: 0, amount: 0 }
      discountsByType[name].count++; discountsByType[name].amount += amount
    })
  })

  // Stats
  const checkCount = orders.length
  const avgCheck = checkCount > 0 ? totalCollected / checkCount : 0
  let totalCoversLegacy = 0
  orders.forEach(order => { totalCoversLegacy += order.guestCount || 1 })
  const avgCover = totalCoversLegacy > 0 ? totalCollected / totalCoversLegacy : 0
  let totalCheckTime = 0, checkTimeCount = 0
  orders.forEach(order => { if (order.closedAt && order.createdAt) { totalCheckTime += (order.closedAt.getTime() - order.createdAt.getTime()) / (1000 * 60); checkTimeCount++ } })
  const avgCheckTime = checkTimeCount > 0 ? totalCheckTime / checkTimeCount : 0

  let foodTotal = 0, bevTotal = 0, retailTotal = 0
  Object.values(salesByCategory).forEach(cat => {
    if (cat.categoryType === 'food') foodTotal += cat.net
    else if (['drinks', 'liquor', 'beer', 'wine'].includes(cat.categoryType)) bevTotal += cat.net
    else if (cat.categoryType === 'retail') retailTotal += cat.net
  })

  const ccTipFees = await db.tipTransaction.aggregate({
    _sum: { ccFeeAmountCents: true }, _count: true,
    where: { locationId, collectedAt: { gte: startOfDay, lte: endOfDay }, ccFeeAmountCents: { gt: 0 }, deletedAt: null },
  })

  return ok({
    reportDate: date.toISOString().split('T')[0],
    generatedAt: new Date().toISOString(),
    revenue: {
      adjustedGrossSales: round(preTaxGrossSales), discounts: round(totalDiscounts),
      netSales: round(netSales), salesTax: round(totalTax),
      taxFromInclusive: round(totalTaxFromInclusive), taxFromExclusive: round(totalTaxFromExclusive),
      surcharge: round(totalSurcharge), grossSales: round(grossSales),
      tips: round(totalTips), gratuity: 0, refunds: round(totalRefunds),
      giftCardLoads: round(gcResult.giftCardLoads),
      roundingAdjustments: round(totalRoundingAdjustments),
      totalCollected: round(totalCollected), commission: round(totalCommission), donations: 0,
    },
    payments: {
      cash: { count: paymentsByType.cash.count, amount: round(paymentsByType.cash.amount), tips: round(paymentsByType.cash.tips) },
      credit: {
        count: paymentsByType.credit.count, amount: round(paymentsByType.credit.amount), tips: round(paymentsByType.credit.tips),
        breakdown: { visa: creditCardBreakdown.visa, mastercard: creditCardBreakdown.mastercard, amex: creditCardBreakdown.amex, discover: creditCardBreakdown.discover, other: creditCardBreakdown.other },
      },
      debit: { count: paymentsByType.debit.count, amount: round(paymentsByType.debit.amount), tips: round(paymentsByType.debit.tips) },
      gift: { count: paymentsByType.gift.count, amount: round(paymentsByType.gift.amount) },
      houseAccount: { count: paymentsByType.house_account.count, amount: round(paymentsByType.house_account.amount) },
      roomCharge: { count: paymentsByType.room_charge.count, amount: round(paymentsByType.room_charge.amount), tips: round(paymentsByType.room_charge.tips) },
      loyaltyPoints: { count: paymentsByType.loyalty_points.count, amount: round(paymentsByType.loyalty_points.amount) },
      other: { count: paymentsByType.other.count, amount: round(paymentsByType.other.amount) },
      totalPayments: round(totalPayments),
    },
    cash: {
      cashReceived: round(cashReceived), cashIn: round(cashResult.cashIn), cashOut: round(cashResult.cashOut),
      tipsOut: round(cashResult.cashTipsOut), roundingAdjustments: round(totalRoundingAdjustments),
      tipSharesIn: round(tipShareResult.totalTipSharesDistributed),
      cashDue: round(cashDue + tipShareResult.totalTipSharesDistributed + totalRoundingAdjustments),
    },
    paidInOut: { paidIn: round(cashResult.cashIn), paidOut: round(cashResult.cashOut), net: round(cashResult.cashIn - cashResult.cashOut) },
    salesByCategory: Object.values(salesByCategory)
      .filter(c => c.gross > 0 || c.voids > 0)
      .map(c => ({ ...c, gross: round(c.gross), discounts: round(c.discounts), net: round(c.net), voids: round(c.voids), percentOfTotal: netSales > 0 ? round((c.net / netSales) * 100) : 0 }))
      .sort((a, b) => b.net - a.net),
    salesByOrderType: Object.values(salesByOrderType).map(t => ({ ...t, gross: round(t.gross), net: round(t.net) })).sort((a, b) => b.net - a.net),
    voids: {
      tickets: { count: voidsResult.voidedTicketCount, amount: round(voidsResult.voidedTicketAmount) },
      items: { count: voidsResult.voidedItemCount, amount: round(voidsResult.voidedItemAmount) },
      total: { count: voidsResult.voidedTicketCount + voidsResult.voidedItemCount, amount: round(voidsResult.totalVoids) },
      percentOfSales: round(voidsResult.voidPercentage),
      byReason: Object.entries(voidsResult.voidsByReason).map(([reason, data]) => ({ reason, count: data.count, amount: round(data.amount) })),
    },
    discounts: {
      total: round(totalDiscounts),
      byType: Object.entries(discountsByType).map(([name, data]) => ({ name, count: data.count, amount: round(data.amount) })).sort((a, b) => b.amount - a.amount),
    },
    labor: {
      frontOfHouse: { hours: round(laborResult.fohHours), cost: round(laborResult.fohCost), percentOfLabor: laborResult.totalLaborCost > 0 ? round((laborResult.fohCost / laborResult.totalLaborCost) * 100) : 0 },
      backOfHouse: { hours: round(laborResult.bohHours), cost: round(laborResult.bohCost), percentOfLabor: laborResult.totalLaborCost > 0 ? round((laborResult.bohCost / laborResult.totalLaborCost) * 100) : 0 },
      total: { hours: round(laborResult.totalLaborHours), cost: round(laborResult.totalLaborCost), percentOfSales: round(laborResult.laborPercentage) },
    },
    giftCards: { loads: round(gcResult.giftCardLoads), redemptions: round(gcResult.giftCardRedemptions), netLiability: round(gcResult.giftCardLoads - gcResult.giftCardRedemptions) },
    tipShares: {
      totalDistributed: round(tipShareResult.totalTipSharesDistributed),
      byEmployee: Object.values(tipShareResult.tipSharesByGiver).map(g => ({
        employeeId: g.employeeId, employeeName: g.employeeName, totalGiven: round(g.totalGiven),
        shares: g.shares.map(s => ({ ...s, amount: round(s.amount) })),
      })).sort((a, b) => b.totalGiven - a.totalGiven),
    },
    tipBank: { total: round(tipShareResult.totalTipSharesDistributed), pendingPayroll: round(tipShareResult.totalTipSharesDistributed) },
    weightBasedSales: weightBasedItemCount > 0 ? {
      revenue: round(weightBasedRevenue), itemCount: weightBasedItemCount,
      totalWeight: Object.entries(weightByUnit).map(([unit, weight]) => ({ unit, weight: round(weight) })),
    } : null,
    stats: {
      checks: checkCount, avgCheck: round(avgCheck), avgCheckTimeMinutes: round(avgCheckTime),
      covers: totalCoversLegacy, avgCover: round(avgCover),
      foodAvg: round(checkCount > 0 ? foodTotal / checkCount : 0),
      bevAvg: round(checkCount > 0 ? bevTotal / checkCount : 0),
      retailAvg: round(checkCount > 0 ? retailTotal / checkCount : 0),
    },
    businessCosts: { ccTipFees: round(Number(ccTipFees._sum.ccFeeAmountCents || 0) / 100), ccTipFeeTransactions: ccTipFees._count || 0 },
  })
}
