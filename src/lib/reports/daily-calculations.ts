/**
 * Daily Report Calculation Helpers
 *
 * Extracted from the daily report route to keep the route handler thin.
 * All functions are pure (no DB access) — they transform pre-fetched data
 * into the report response shape.
 */

// ─── Rounding ────────────────────────────────────────────────────────────────

export function round(value: number): number {
  return Math.round(value * 100) / 100
}

// ─── Payment Processing ──────────────────────────────────────────────────────

export interface PaymentByType {
  count: number
  amount: number
  tips: number
}

export interface CreditCardBreakdownEntry {
  count: number
  amount: number
}

export interface PaymentResult {
  paymentsByType: Record<string, PaymentByType>
  creditCardBreakdown: Record<string, CreditCardBreakdownEntry>
  totalRoundingAdjustments: number
  totalPayments: number
}

export function processPaymentSummary(
  paymentSummary: Array<{
    payment_method: string | null
    total: unknown
    tips: unknown
    count: unknown
    rounding: unknown
    card_brand: string | null
  }>
): PaymentResult {
  const paymentsByType: Record<string, PaymentByType> = {
    cash: { count: 0, amount: 0, tips: 0 },
    credit: { count: 0, amount: 0, tips: 0 },
    debit: { count: 0, amount: 0, tips: 0 },
    gift: { count: 0, amount: 0, tips: 0 },
    house_account: { count: 0, amount: 0, tips: 0 },
    room_charge: { count: 0, amount: 0, tips: 0 },
    loyalty_points: { count: 0, amount: 0, tips: 0 },
    other: { count: 0, amount: 0, tips: 0 },
  }

  const creditCardBreakdown: Record<string, CreditCardBreakdownEntry> = {
    visa: { count: 0, amount: 0 },
    mastercard: { count: 0, amount: 0 },
    amex: { count: 0, amount: 0 },
    discover: { count: 0, amount: 0 },
    other: { count: 0, amount: 0 },
  }

  let totalRoundingAdjustments = 0

  paymentSummary.forEach(row => {
    const paymentType = (row.payment_method || 'other').toLowerCase()
    const amount = Number(row.total) || 0
    const tip = Number(row.tips) || 0
    const count = Number(row.count) || 0
    const rounding = Number(row.rounding) || 0

    totalRoundingAdjustments += rounding

    if (paymentType === 'cash') {
      paymentsByType.cash.count += count
      paymentsByType.cash.amount += amount
      paymentsByType.cash.tips += tip
    } else if (paymentType === 'credit' || paymentType === 'card') {
      paymentsByType.credit.count += count
      paymentsByType.credit.amount += amount
      paymentsByType.credit.tips += tip

      const cardType = (row.card_brand || 'other').toLowerCase()
      if (cardType.includes('visa')) {
        creditCardBreakdown.visa.count += count
        creditCardBreakdown.visa.amount += amount
      } else if (cardType.includes('master')) {
        creditCardBreakdown.mastercard.count += count
        creditCardBreakdown.mastercard.amount += amount
      } else if (cardType.includes('amex') || cardType.includes('american')) {
        creditCardBreakdown.amex.count += count
        creditCardBreakdown.amex.amount += amount
      } else if (cardType.includes('discover')) {
        creditCardBreakdown.discover.count += count
        creditCardBreakdown.discover.amount += amount
      } else {
        creditCardBreakdown.other.count += count
        creditCardBreakdown.other.amount += amount
      }
    } else if (paymentType === 'debit') {
      paymentsByType.debit.count += count
      paymentsByType.debit.amount += amount
      paymentsByType.debit.tips += tip
    } else if (paymentType === 'gift' || paymentType === 'gift_card') {
      paymentsByType.gift.count += count
      paymentsByType.gift.amount += amount
      paymentsByType.gift.tips += tip
    } else if (paymentType === 'house_account') {
      paymentsByType.house_account.count += count
      paymentsByType.house_account.amount += amount
    } else if (paymentType === 'room_charge') {
      paymentsByType.room_charge.count += count
      paymentsByType.room_charge.amount += amount
      paymentsByType.room_charge.tips += tip
    } else if (paymentType === 'loyalty_points' || paymentType === 'loyalty') {
      paymentsByType.loyalty_points.count += count
      paymentsByType.loyalty_points.amount += amount
    } else {
      paymentsByType.other.count += count
      paymentsByType.other.amount += amount
      paymentsByType.other.tips += tip
    }
  })

  const totalPayments = Object.values(paymentsByType).reduce(
    (sum, p) => sum + p.amount, 0
  )

  return { paymentsByType, creditCardBreakdown, totalRoundingAdjustments, totalPayments }
}

// ─── Category Sales ──────────────────────────────────────────────────────────

export interface CategoryEntry {
  name: string
  categoryType: string
  units: number
  gross: number
  discounts: number
  net: number
  voids: number
}

export function buildCategoryMap(
  categories: Array<{ id: string; name: string; categoryType: string | null }>,
  categorySales: Array<{
    category_id: string
    category_name: string
    category_type: string | null
    units: unknown
    gross: unknown
    inclusive_gross: unknown
    discount_share: unknown
  }>,
  categoryVoids: Array<{ category_id: string; void_amount: unknown }>,
  catInclRate: number,
): Record<string, CategoryEntry> {
  const catMap: Record<string, CategoryEntry> = {}

  categories.forEach(cat => {
    catMap[cat.id] = {
      name: cat.name,
      categoryType: cat.categoryType || 'food',
      units: 0,
      gross: 0,
      discounts: 0,
      net: 0,
      voids: 0,
    }
  })

  categorySales.forEach(row => {
    const id = row.category_id
    if (!catMap[id]) {
      catMap[id] = {
        name: row.category_name,
        categoryType: row.category_type || 'food',
        units: 0,
        gross: 0,
        discounts: 0,
        net: 0,
        voids: 0,
      }
    }
    catMap[id].units = Number(row.units) || 0
    const rawGross = Number(row.gross) || 0
    const inclusiveGross = Number(row.inclusive_gross) || 0
    const backedOutTax = (catInclRate > 0 && inclusiveGross > 0)
      ? Math.round((inclusiveGross - inclusiveGross / (1 + catInclRate)) * 100) / 100
      : 0
    catMap[id].gross = rawGross - backedOutTax
    catMap[id].discounts = Number(row.discount_share) || 0
  })

  categoryVoids.forEach(row => {
    if (catMap[row.category_id]) {
      catMap[row.category_id].voids = Number(row.void_amount) || 0
    }
  })

  Object.values(catMap).forEach(cat => {
    cat.net = cat.gross - cat.discounts
  })

  return catMap
}

// ─── Void Aggregation ────────────────────────────────────────────────────────

export interface VoidResult {
  voidedTicketCount: number
  voidedTicketAmount: number
  voidedItemCount: number
  voidedItemAmount: number
  voidsByReason: Record<string, { count: number; amount: number }>
  totalVoids: number
  voidPercentage: number
}

export function processVoidLogs(
  voidLogs: Array<{ amount: unknown; reason: string | null; itemId: string | null }>,
  adjustedGrossSales: number,
): VoidResult {
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

  return { voidedTicketCount, voidedTicketAmount, voidedItemCount, voidedItemAmount, voidsByReason, totalVoids, voidPercentage }
}

// ─── Labor Summary ───────────────────────────────────────────────────────────

export interface LaborResult {
  fohHours: number
  fohCost: number
  bohHours: number
  bohCost: number
  totalLaborHours: number
  totalLaborCost: number
  laborPercentage: number
}

export function processLaborEntries(
  timeEntries: Array<{
    clockIn: Date
    clockOut: Date | null
    breakMinutes: number | null
    employee: {
      hourlyRate: unknown
      role: { name: string } | null
    }
  }>,
  netSales: number,
): LaborResult {
  let fohHours = 0
  let fohCost = 0
  let bohHours = 0
  let bohCost = 0

  timeEntries.forEach(entry => {
    if (!entry.clockOut) return

    const hours = (entry.clockOut.getTime() - entry.clockIn.getTime()) / (1000 * 60 * 60)
    const breakHours = (entry.breakMinutes || 0) / 60
    const netHours = Math.max(0, hours - breakHours)
    const hourlyRate = Number(entry.employee.hourlyRate) || 0
    const cost = netHours * hourlyRate

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

  return { fohHours, fohCost, bohHours, bohCost, totalLaborHours, totalLaborCost, laborPercentage }
}

// ─── Gift Card Summary ───────────────────────────────────────────────────────

export interface GiftCardResult {
  giftCardLoads: number
  giftCardRedemptions: number
}

export function processGiftCardTransactions(
  transactions: Array<{ type: string; amount: unknown }>,
): GiftCardResult {
  let giftCardLoads = 0
  let giftCardRedemptions = 0

  transactions.forEach(txn => {
    const amount = Number(txn.amount) || 0
    if (txn.type === 'load' || txn.type === 'sale') {
      giftCardLoads += amount
    } else if (txn.type === 'redeem' || txn.type === 'redemption') {
      giftCardRedemptions += amount
    }
  })

  return { giftCardLoads, giftCardRedemptions }
}

// ─── Tip Shares ──────────────────────────────────────────────────────────────

export interface TipShareByGiver {
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
}

export interface TipShareResult {
  tipSharesByGiver: Record<string, TipShareByGiver>
  totalTipSharesDistributed: number
}

interface TipLedgerEntry {
  type: string
  amountCents: unknown
  sourceId: string | null
  memo: string | null
  employee: {
    id: string
    firstName: string
    lastName: string
    displayName: string | null
  }
}

export function processTipShares(tipSharesDistributed: TipLedgerEntry[]): TipShareResult {
  const tipSharesByGiver: Record<string, TipShareByGiver> = {}
  const tipoutDebits = tipSharesDistributed.filter(e => e.type === 'DEBIT')
  const tipoutCredits = tipSharesDistributed.filter(e => e.type === 'CREDIT')

  tipoutDebits.forEach(entry => {
    const giverId = entry.employee.id
    const giverName = entry.employee.displayName ||
      `${entry.employee.firstName} ${entry.employee.lastName}`
    const amount = Math.abs(Number(entry.amountCents)) / 100

    if (!tipSharesByGiver[giverId]) {
      tipSharesByGiver[giverId] = {
        employeeId: giverId,
        employeeName: giverName,
        totalGiven: 0,
        shares: [],
      }
    }

    const matchingCredit = entry.sourceId
      ? tipoutCredits.find(c => c.sourceId === entry.sourceId)
      : null
    const recipientName = matchingCredit
      ? (matchingCredit.employee.displayName ||
        `${matchingCredit.employee.firstName} ${matchingCredit.employee.lastName}`)
      : 'Unknown'

    tipSharesByGiver[giverId].totalGiven += amount
    tipSharesByGiver[giverId].shares.push({
      toEmployee: recipientName,
      amount,
      shareType: 'role_tipout',
      ruleName: entry.memo || null,
      percentage: null,
      status: 'completed',
    })
  })

  const totalTipSharesDistributed = tipoutDebits.reduce(
    (sum, entry) => sum + Math.abs(Number(entry.amountCents)) / 100, 0
  )

  return { tipSharesByGiver, totalTipSharesDistributed }
}

// ─── Cash Reconciliation ─────────────────────────────────────────────────────

export interface CashResult {
  cashReceived: number
  cashIn: number
  cashOut: number
  cashTipsOut: number
  cashDue: number
}

export function processCashReconciliation(
  cashPaymentAmount: number,
  tipsCollectedToday: Array<{ sourceType: string; amountCents: unknown }>,
  paidInOuts: Array<{ type: string; amount: unknown }>,
): CashResult {
  const cashPayoutsToday = tipsCollectedToday
    .filter(e => e.sourceType === 'PAYOUT_CASH')
    .reduce((sum, e) => sum + Math.abs(Number(e.amountCents)) / 100, 0)

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

  return {
    cashReceived: cashPaymentAmount,
    cashIn,
    cashOut,
    cashTipsOut: cashPayoutsToday,
    cashDue: cashPaymentAmount + cashIn - cashOut - cashPayoutsToday,
  }
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export interface StatsResult {
  checkCount: number
  avgCheck: number
  avgCheckTime: number
  totalCovers: number
  avgCover: number
  foodAvg: number
  bevAvg: number
  retailAvg: number
}

export function computeStats(
  checkCount: number,
  totalCovers: number,
  closedOrderCount: number,
  totalCheckTimeMinutes: number,
  totalCollected: number,
  catMap: Record<string, CategoryEntry>,
): StatsResult {
  const avgCheck = checkCount > 0 ? totalCollected / checkCount : 0
  const totalCoversOrDefault = totalCovers > 0 ? totalCovers : checkCount
  const avgCover = totalCoversOrDefault > 0 ? totalCollected / totalCoversOrDefault : 0
  const avgCheckTime = closedOrderCount > 0 ? totalCheckTimeMinutes / closedOrderCount : 0

  let foodTotal = 0
  let bevTotal = 0
  let retailTotal = 0

  Object.values(catMap).forEach(cat => {
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

  return {
    checkCount,
    avgCheck,
    avgCheckTime,
    totalCovers,
    avgCover,
    foodAvg: checkCount > 0 ? foodTotal / checkCount : 0,
    bevAvg: checkCount > 0 ? bevTotal / checkCount : 0,
    retailAvg: checkCount > 0 ? retailTotal / checkCount : 0,
  }
}

// ─── Weight-Based Sales ──────────────────────────────────────────────────────

export interface WeightSalesResult {
  weightBasedRevenue: number
  weightBasedItemCount: number
  weightByUnit: Record<string, number>
}

export function processWeightSales(
  weightSummary: Array<{ revenue: unknown; item_count: unknown; total_weight: unknown; weight_unit: string | null }>,
): WeightSalesResult {
  let weightBasedRevenue = 0
  let weightBasedItemCount = 0
  const weightByUnit: Record<string, number> = {}

  weightSummary.forEach(row => {
    weightBasedRevenue += Number(row.revenue) || 0
    weightBasedItemCount += Number(row.item_count) || 0
    const unit = row.weight_unit || 'lb'
    weightByUnit[unit] = (weightByUnit[unit] || 0) + (Number(row.total_weight) || 0)
  })

  return { weightBasedRevenue, weightBasedItemCount, weightByUnit }
}
