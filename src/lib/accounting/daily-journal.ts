/**
 * Daily Sales Journal Generator
 *
 * Aggregates all financial activity for a business day into double-entry
 * journal entries suitable for export to QuickBooks, Xero, or CSV.
 *
 * Invariant: total debits MUST equal total credits (balanced journal).
 *
 * TODO: Migrate to repositories. This file takes db: PrismaClient as a param
 * and runs 6 parallel queries with complex WHERE shapes (date ranges, nested
 * order filters, status arrays). Requires new repo methods for:
 * - OrderRepository: findMany with date range + items include + category join
 * - PaymentRepository: findMany with nested order date filter
 * - OrderItemRepository: findMany by status + date range
 * - No repos exist for: OrderDiscount, VoidLog, TimeClockEntry
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { getBusinessDayRange } from '@/lib/business-day'
import { parseSettings, DEFAULT_ACCOUNTING_SETTINGS, DEFAULT_GL_MAPPING } from '@/lib/settings'
import type { AccountingGLMapping } from '@/lib/settings'
import { REVENUE_ORDER_STATUSES } from '@/lib/constants'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JournalEntry {
  date: string              // YYYY-MM-DD
  accountCode: string       // GL account code
  accountName: string       // Human-readable account name
  debit: number             // Debit amount (0 if credit)
  credit: number            // Credit amount (0 if debit)
  memo: string              // Description/memo for the line
}

export interface DailyJournalResult {
  date: string
  entries: JournalEntry[]
  totalDebits: number
  totalCredits: number
  isBalanced: boolean
  summary: JournalSummary
}

export interface JournalSummary {
  totalSales: number
  totalCash: number
  totalCard: number
  totalGiftCard: number
  totalHouseAccount: number
  totalTax: number
  totalTips: number
  totalDiscounts: number
  totalRefunds: number
  totalComps: number
  totalLaborCost: number
  salesByCategory: Record<string, number>
}

// ─── GL Account Name Lookup ──────────────────────────────────────────────────

const GL_ACCOUNT_NAMES: Record<string, string> = {
  salesRevenue: 'Sales Revenue',
  cashPayments: 'Cash',
  cardPayments: 'Credit/Debit Card Receivable',
  giftCardPayments: 'Gift Card Receivable',
  houseAccountPayments: 'House Account Receivable',
  taxCollected: 'Sales Tax Payable',
  tipsPayable: 'Tips Payable',
  discounts: 'Discounts & Allowances',
  refunds: 'Refunds',
  comps: 'Comps & Write-Offs',
  cogs: 'Cost of Goods Sold',
  laborCost: 'Labor Cost',
}

function getAccountName(glKey: string, code: string): string {
  return GL_ACCOUNT_NAMES[glKey] || `Account ${code}`
}

// ─── Core Generator ──────────────────────────────────────────────────────────

export async function generateDailySalesJournal(
  db: PrismaClient,
  locationId: string,
  businessDate: string // YYYY-MM-DD
): Promise<DailyJournalResult> {
  // Get location settings for business day boundary and GL mapping
  const location = await db.location.findFirst({
    where: { id: locationId },
    select: { settings: true },
  })

  const settings = parseSettings(location?.settings as Record<string, unknown> | null)
  const dayStartTime = settings.businessDay?.dayStartTime || '04:00'
  const accounting = settings.accounting ?? DEFAULT_ACCOUNTING_SETTINGS
  const gl: AccountingGLMapping = { ...DEFAULT_GL_MAPPING, ...accounting.glMapping }

  // Calculate business day range
  const { start, end } = getBusinessDayRange(businessDate, dayStartTime)

  // ─── Parallel Data Fetch ──────────────────────────────────────────────
  const [
    orders,
    payments,
    discounts,
    voidLogs,
    compedItems,
    timeClockEntries,
  ] = await Promise.all([
    // All completed/paid orders for the business day
    db.order.findMany({
      where: {
        locationId,
        status: { in: [...REVENUE_ORDER_STATUSES] },
        NOT: { splitOrders: { some: {} } }, // Exclude split parents
        OR: [
          { businessDayDate: new Date(businessDate) },
          { businessDayDate: null, createdAt: { gte: start, lte: end } },
        ],
      },
      select: {
        id: true,
        subtotal: true,
        taxTotal: true,
        tipTotal: true,
        total: true,
        items: {
          where: { deletedAt: null, status: 'active' },
          select: {
            id: true,
            itemTotal: true,
            costAtSale: true,
            categoryType: true,
            quantity: true,
            menuItem: {
              select: {
                categoryId: true,
                category: { select: { name: true, categoryType: true } },
              },
            },
          },
        },
      },
    }),

    // All payments for the day — join to orders by businessDayDate for alignment
    db.payment.findMany({
      where: {
        locationId,
        deletedAt: null,
        order: {
          OR: [
            { businessDayDate: new Date(businessDate) },
            { businessDayDate: null, createdAt: { gte: start, lte: end } },
          ],
        },
      },
      select: {
        id: true,
        amount: true,
        tipAmount: true,
        totalAmount: true,
        paymentMethod: true,
        status: true,
        refundedAmount: true,
        voidedAt: true,
        cardBrand: true,
      },
    }),

    // All discounts applied
    db.orderDiscount.findMany({
      where: {
        locationId,
        deletedAt: null,
        createdAt: { gte: start, lte: end },
      },
      select: {
        id: true,
        amount: true,
        name: true,
      },
    }),

    // Void logs (item and order voids — these are TRUE voids, not comps)
    db.voidLog.findMany({
      where: {
        locationId,
        deletedAt: null,
        createdAt: { gte: start, lte: end },
      },
      select: {
        id: true,
        amount: true,
        voidType: true,
      },
    }),

    // Comped items — queried separately from voids for accurate comp totals
    db.orderItem.findMany({
      where: {
        locationId,
        status: 'comped',
        deletedAt: null,
        updatedAt: { gte: start, lte: end },
      },
      select: {
        id: true,
        itemTotal: true,
      },
    }),

    // Time clock for labor cost
    db.timeClockEntry.findMany({
      where: {
        locationId,
        deletedAt: null,
        clockIn: { lte: end },
        OR: [
          { clockOut: { gte: start } },
          { clockOut: null }, // Still clocked in
        ],
      },
      select: {
        id: true,
        clockIn: true,
        clockOut: true,
        regularHours: true,
        overtimeHours: true,
        employee: {
          select: { hourlyRate: true },
        },
      },
    }),
  ])

  // ─── Aggregation ────────────────────────────────────────────────────────

  // 1. Total sales by category
  const salesByCategory: Record<string, number> = {}
  let totalSales = 0

  for (const order of orders) {
    for (const item of order.items) {
      const catName = item.menuItem?.category?.name || item.categoryType || 'Uncategorized'
      const amount = Number(item.itemTotal)
      salesByCategory[catName] = (salesByCategory[catName] || 0) + amount
      totalSales += amount
    }
  }

  // 2. Payment aggregation by method
  let totalCash = 0
  let totalCard = 0
  let totalGiftCard = 0
  let totalHouseAccount = 0
  let totalRoomCharge = 0
  let totalTips = 0
  let totalRefunds = 0

  for (const payment of payments) {
    if (payment.voidedAt || payment.status === 'voided') continue

    const amount = Number(payment.amount)
    const tip = Number(payment.tipAmount)
    const refunded = Number(payment.refundedAmount)

    totalTips += tip
    totalRefunds += refunded

    switch (payment.paymentMethod) {
      case 'cash':
        totalCash += amount
        break
      case 'card':
      case 'credit':
      case 'debit':
        totalCard += amount
        break
      case 'gift_card':
        totalGiftCard += amount
        break
      case 'house_account':
        totalHouseAccount += amount
        break
      case 'room_charge':
        totalRoomCharge += amount
        break
    }
  }

  // 3. Total tax
  let totalTax = 0
  for (const order of orders) {
    totalTax += Number(order.taxTotal)
  }

  // 4. Total discounts
  let totalDiscounts = 0
  for (const discount of discounts) {
    totalDiscounts += Number(discount.amount)
  }

  // 5. Total comps — from comped order items (separate from voids)
  let totalComps = 0
  for (const item of compedItems) {
    totalComps += Number(item.itemTotal)
  }

  // 5b. Total voids — from void logs (true voids, not comps)
  let totalVoids = 0
  for (const voidLog of voidLogs) {
    totalVoids += Number(voidLog.amount)
  }

  // 6. Labor cost from time clock entries
  let totalLaborCost = 0
  for (const entry of timeClockEntries) {
    const rate = Number(entry.employee.hourlyRate || 0)
    if (rate <= 0) continue

    const regular = Number(entry.regularHours || 0)
    const overtime = Number(entry.overtimeHours || 0)

    if (regular > 0 || overtime > 0) {
      totalLaborCost += (regular * rate) + (overtime * rate * 1.5)
    } else if (entry.clockOut) {
      // Calculate from clock in/out times, clamped to business day
      const clockIn = new Date(Math.max(entry.clockIn.getTime(), start.getTime()))
      const clockOut = new Date(Math.min(entry.clockOut.getTime(), end.getTime()))
      const hoursWorked = Math.max(0, (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60))
      totalLaborCost += hoursWorked * rate
    }
  }

  // Round all totals to 2 decimal places
  totalSales = round2(totalSales)
  totalCash = round2(totalCash)
  totalCard = round2(totalCard)
  totalGiftCard = round2(totalGiftCard)
  totalHouseAccount = round2(totalHouseAccount)
  totalTax = round2(totalTax)
  totalTips = round2(totalTips)
  totalDiscounts = round2(totalDiscounts)
  totalRefunds = round2(totalRefunds)
  totalComps = round2(totalComps)
  totalLaborCost = round2(totalLaborCost)

  // ─── Build Journal Entries (Double-Entry) ────────────────────────────────
  //
  // Accounting equation: Assets = Liabilities + Equity
  //
  // DEBITS (left side — assets increase, contra-revenue increases):
  //   Cash received
  //   Card receivables
  //   Gift card receivables
  //   House account receivables
  //   Discounts (contra-revenue)
  //   Refunds (contra-revenue)
  //   Comps (expense)
  //   COGS (expense, if available)
  //   Labor cost (expense)
  //
  // CREDITS (right side — revenue increases, liabilities increase):
  //   Sales revenue
  //   Tax collected (liability)
  //   Tips payable (liability)

  const entries: JournalEntry[] = []

  // ── Asset/Receivable Debits ─────────────────────────────────────
  if (totalCash > 0) {
    entries.push({
      date: businessDate,
      accountCode: gl.cashPayments,
      accountName: getAccountName('cashPayments', gl.cashPayments),
      debit: totalCash,
      credit: 0,
      memo: 'Daily cash receipts',
    })
  }

  if (totalCard > 0) {
    entries.push({
      date: businessDate,
      accountCode: gl.cardPayments,
      accountName: getAccountName('cardPayments', gl.cardPayments),
      debit: totalCard,
      credit: 0,
      memo: 'Daily credit/debit card receivables',
    })
  }

  if (totalGiftCard > 0) {
    entries.push({
      date: businessDate,
      accountCode: gl.giftCardPayments,
      accountName: getAccountName('giftCardPayments', gl.giftCardPayments),
      debit: totalGiftCard,
      credit: 0,
      memo: 'Daily gift card redemptions',
    })
  }

  if (totalHouseAccount > 0) {
    entries.push({
      date: businessDate,
      accountCode: gl.houseAccountPayments,
      accountName: getAccountName('houseAccountPayments', gl.houseAccountPayments),
      debit: totalHouseAccount,
      credit: 0,
      memo: 'Daily house account charges',
    })
  }

  // ── Contra-Revenue / Expense Debits ─────────────────────────────
  if (totalDiscounts > 0) {
    entries.push({
      date: businessDate,
      accountCode: gl.discounts,
      accountName: getAccountName('discounts', gl.discounts),
      debit: totalDiscounts,
      credit: 0,
      memo: 'Daily discounts applied',
    })
  }

  if (totalRefunds > 0) {
    entries.push({
      date: businessDate,
      accountCode: gl.refunds,
      accountName: getAccountName('refunds', gl.refunds),
      debit: totalRefunds,
      credit: 0,
      memo: 'Daily refunds issued',
    })
  }

  if (totalComps > 0) {
    entries.push({
      date: businessDate,
      accountCode: gl.comps,
      accountName: getAccountName('comps', gl.comps),
      debit: totalComps,
      credit: 0,
      memo: 'Daily comps (comped items)',
    })
  }

  if (totalVoids > 0) {
    entries.push({
      date: businessDate,
      accountCode: gl.comps,
      accountName: 'Voids',
      debit: totalVoids,
      credit: 0,
      memo: 'Daily voids (voided items/orders)',
    })
  }

  if (totalLaborCost > 0) {
    entries.push({
      date: businessDate,
      accountCode: gl.laborCost,
      accountName: getAccountName('laborCost', gl.laborCost),
      debit: totalLaborCost,
      credit: 0,
      memo: 'Daily labor cost (from time clock)',
    })
  }

  // ── Revenue Credits ─────────────────────────────────────────────
  // Sales revenue = gross sales (what was collected minus tax and tips)
  // The formula: cash + card + gift + house = sales - discounts - refunds - comps + tax + tips
  // So: sales credit = cash + card + gift + house + discounts + refunds + comps - tax - tips
  // But in double-entry, we credit the full gross sales and separately handle contra items.
  //
  // Correct approach:
  //   Sales Revenue (credit) = totalSales (item totals before discounts are already net in our data)
  //   We already debited discounts/refunds/comps as contra-revenue.
  //   The balancing: Assets received = Net Sales + Tax + Tips
  //   Net Sales = Gross Sales - Discounts - Refunds - Comps
  //   So: Cash + Card + Gift + House = (Sales - Discounts - Refunds - Comps) + Tax + Tips
  //
  //   We debit: Cash, Card, Gift, House, Discounts, Refunds, Comps, Labor
  //   We credit: Sales, Tax, Tips, Labor (expense offset = COGS or a balancing entry)
  //
  //   For the journal to balance:
  //   Total Debits = Cash + Card + Gift + House + Discounts + Refunds + Comps + Labor
  //   Total Credits = Sales + Tax + Tips + Labor
  //
  //   But Labor is an expense (debit) with no corresponding credit in this journal
  //   (it reduces equity through the income statement). We need to credit a liability
  //   or equity account. For simplicity, labor debit is offset by a credit to
  //   "Wages Payable" which uses the same GL code.

  if (totalSales > 0) {
    entries.push({
      date: businessDate,
      accountCode: gl.salesRevenue,
      accountName: getAccountName('salesRevenue', gl.salesRevenue),
      debit: 0,
      credit: totalSales,
      memo: `Daily sales revenue (${Object.keys(salesByCategory).length} categories)`,
    })
  }

  if (totalTax > 0) {
    entries.push({
      date: businessDate,
      accountCode: gl.taxCollected,
      accountName: getAccountName('taxCollected', gl.taxCollected),
      debit: 0,
      credit: totalTax,
      memo: 'Daily sales tax collected',
    })
  }

  if (totalTips > 0) {
    entries.push({
      date: businessDate,
      accountCode: gl.tipsPayable,
      accountName: getAccountName('tipsPayable', gl.tipsPayable),
      debit: 0,
      credit: totalTips,
      memo: 'Daily tips payable to employees',
    })
  }

  // Labor cost credit (wages payable — matches the debit above)
  if (totalLaborCost > 0) {
    entries.push({
      date: businessDate,
      accountCode: gl.laborCost,
      accountName: 'Wages Payable',
      debit: 0,
      credit: totalLaborCost,
      memo: 'Daily labor accrual (wages payable)',
    })
  }

  // ─── Balance Check ──────────────────────────────────────────────────────

  const totalDebits = round2(entries.reduce((sum, e) => sum + e.debit, 0))
  const totalCredits = round2(entries.reduce((sum, e) => sum + e.credit, 0))
  const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01

  // If not balanced due to rounding, add a rounding adjustment
  if (!isBalanced && entries.length > 0) {
    const diff = round2(totalDebits - totalCredits)
    if (Math.abs(diff) < 1.00) {
      // Small rounding difference — add adjustment entry
      if (diff > 0) {
        entries.push({
          date: businessDate,
          accountCode: gl.salesRevenue,
          accountName: 'Rounding Adjustment',
          debit: 0,
          credit: Math.abs(diff),
          memo: 'Rounding adjustment to balance journal',
        })
      } else {
        entries.push({
          date: businessDate,
          accountCode: gl.salesRevenue,
          accountName: 'Rounding Adjustment',
          debit: Math.abs(diff),
          credit: 0,
          memo: 'Rounding adjustment to balance journal',
        })
      }
    }
  }

  // Recalculate after adjustment
  const finalDebits = round2(entries.reduce((sum, e) => sum + e.debit, 0))
  const finalCredits = round2(entries.reduce((sum, e) => sum + e.credit, 0))

  return {
    date: businessDate,
    entries,
    totalDebits: finalDebits,
    totalCredits: finalCredits,
    isBalanced: Math.abs(finalDebits - finalCredits) < 0.01,
    summary: {
      totalSales,
      totalCash,
      totalCard,
      totalGiftCard,
      totalHouseAccount,
      totalTax,
      totalTips,
      totalDiscounts,
      totalRefunds,
      totalComps,
      totalLaborCost,
      salesByCategory,
    },
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
