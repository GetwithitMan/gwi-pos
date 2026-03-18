/**
 * Order Reporting Query Service
 *
 * Read-only aggregate queries for reports and dashboards.
 * NOT a CRUD repository -- these are complex analytical queries
 * that compute revenue summaries, category breakdowns, order-type
 * splits, void/discount aggregates, and dashboard live metrics.
 *
 * All queries enforce locationId as the first parameter for tenant safety.
 * Uses adminDb (soft-delete filtering only, no tenant scoping overhead).
 */

import { Prisma } from '@/generated/prisma/client'
import { adminDb } from '@/lib/db'
import { REVENUE_ORDER_STATUSES } from '@/lib/constants'

// ─── SQL Row Types ────────────────────────────────────────────────────────────

export interface RevenueSummaryRow {
  order_count: number
  subtotal: number
  tax_total: number
  tax_from_inclusive: number
  tax_from_exclusive: number
  tip_total: number
  discount_total: number
  commission_total: number
  guest_count: number
  total_check_time_minutes: number
  closed_count: number
}

export interface OrderTypeSummaryRow {
  order_type: string
  count: number
  gross: number
  net: number
}

export interface CategorySalesRow {
  category_id: string
  category_name: string
  category_type: string
  units: number
  gross: number
  inclusive_gross: number
  discount_share: number
}

export interface CategoryVoidsRow {
  category_id: string
  void_amount: number
}

export interface PaymentSummaryRow {
  payment_method: string
  card_brand: string
  count: number
  total: number
  tips: number
  rounding: number
}

export interface DiscountSummaryRow {
  discount_name: string
  count: number
  total: number
}

export interface WeightSummaryRow {
  weight_unit: string
  revenue: number
  item_count: number
  total_weight: number
}

export interface EntertainmentSummaryRow {
  session_count: number
  revenue: number
  total_minutes: number
  top_item_name: string | null
}

export interface SurchargeOrderRow {
  surcharge_base: number
}

// ─── Date Range helpers ───────────────────────────────────────────────────────

export interface BusinessDayRange {
  start: Date
  end: Date
}

// ─── Revenue Summary ──────────────────────────────────────────────────────────

/**
 * Aggregate revenue for a business day window.
 * Returns order count, subtotal, tax breakdown, tips, discounts, commission,
 * guest count, and average check time.
 *
 * Excludes split parents (orders that have child split orders) to prevent
 * double-counting when pay-all-splits marks the parent as 'paid'.
 */
export async function getRevenueSummary(
  locationId: string,
  range: BusinessDayRange,
): Promise<RevenueSummaryRow> {
  const rows = await adminDb.$queryRaw<RevenueSummaryRow[]>(Prisma.sql`
    SELECT
      COUNT(*)::int AS order_count,
      COALESCE(SUM(o.subtotal), 0)::float AS subtotal,
      COALESCE(SUM(o."taxTotal"), 0)::float AS tax_total,
      COALESCE(SUM(o."taxFromInclusive"), 0)::float AS tax_from_inclusive,
      COALESCE(SUM(o."taxFromExclusive"), 0)::float AS tax_from_exclusive,
      COALESCE(SUM(o."tipTotal"), 0)::float AS tip_total,
      COALESCE(SUM(o."discountTotal"), 0)::float AS discount_total,
      COALESCE(SUM(o."commissionTotal"), 0)::float AS commission_total,
      COALESCE(SUM(o."guestCount"), 0)::int AS guest_count,
      COALESCE(SUM(
        CASE WHEN o."closedAt" IS NOT NULL
          THEN EXTRACT(EPOCH FROM (o."closedAt" - o."createdAt")) / 60.0
          ELSE 0 END
      ), 0)::float AS total_check_time_minutes,
      COUNT(CASE WHEN o."closedAt" IS NOT NULL THEN 1 END)::int AS closed_count
    FROM "Order" o
    WHERE o."locationId" = ${locationId}
      AND o.status IN ('completed', 'closed', 'paid')
      AND o."deletedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "Order" child WHERE child."parentOrderId" = o.id)
      AND (
        (o."businessDayDate" >= ${range.start} AND o."businessDayDate" <= ${range.end})
        OR (o."businessDayDate" IS NULL AND o."createdAt" >= ${range.start} AND o."createdAt" <= ${range.end})
      )
  `)

  return rows[0] || {
    order_count: 0, subtotal: 0, tax_total: 0, tax_from_inclusive: 0,
    tax_from_exclusive: 0, tip_total: 0, discount_total: 0, commission_total: 0,
    guest_count: 0, total_check_time_minutes: 0, closed_count: 0,
  }
}

// ─── Sales by Order Type ──────────────────────────────────────────────────────

/**
 * Revenue grouped by order type (dine-in, takeout, delivery, etc.)
 * for the given business day window.
 */
export async function getSalesByOrderType(
  locationId: string,
  range: BusinessDayRange,
): Promise<OrderTypeSummaryRow[]> {
  return adminDb.$queryRaw<OrderTypeSummaryRow[]>(Prisma.sql`
    SELECT
      COALESCE(o."orderType", 'Unknown') AS order_type,
      COUNT(*)::int AS count,
      COALESCE(SUM(o.subtotal + o."taxFromExclusive"), 0)::float AS gross,
      COALESCE(SUM(o.subtotal - o."discountTotal"), 0)::float AS net
    FROM "Order" o
    WHERE o."locationId" = ${locationId}
      AND o.status IN ('completed', 'closed', 'paid')
      AND o."deletedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "Order" child WHERE child."parentOrderId" = o.id)
      AND (
        (o."businessDayDate" >= ${range.start} AND o."businessDayDate" <= ${range.end})
        OR (o."businessDayDate" IS NULL AND o."createdAt" >= ${range.start} AND o."createdAt" <= ${range.end})
      )
    GROUP BY COALESCE(o."orderType", 'Unknown')
  `)
}

// ─── Category Sales ───────────────────────────────────────────────────────────

/**
 * Item-level sales aggregated by category, including modifier revenue.
 * Handles tax-inclusive items via inclusive_gross for back-out calculations.
 */
export async function getCategorySales(
  locationId: string,
  range: BusinessDayRange,
): Promise<CategorySalesRow[]> {
  return adminDb.$queryRaw<CategorySalesRow[]>(Prisma.sql`
    SELECT
      c.id AS category_id,
      c.name AS category_name,
      COALESCE(c."categoryType", 'food') AS category_type,
      COALESCE(SUM(CASE WHEN oi.status = 'active' THEN oi.quantity ELSE 0 END), 0)::int AS units,
      COALESCE(SUM(
        CASE WHEN oi.status = 'active'
          THEN (oi.price * oi.quantity) + COALESCE(mod_totals.mod_total, 0)
          ELSE 0 END
      ), 0)::float AS gross,
      COALESCE(SUM(
        CASE WHEN oi.status = 'active' AND oi."isTaxInclusive" = true
          THEN (oi.price * oi.quantity) + COALESCE(mod_totals.mod_total, 0)
          ELSE 0 END
      ), 0)::float AS inclusive_gross,
      COALESCE(SUM(
        CASE WHEN oi.status = 'active' AND o."subtotal" > 0 AND o."discountTotal" > 0
          THEN (oi.price * oi.quantity)::float / NULLIF(o."subtotal"::float, 0) * o."discountTotal"::float
          ELSE 0 END
      ), 0)::float AS discount_share
    FROM "OrderItem" oi
    JOIN "Order" o ON oi."orderId" = o.id
    JOIN "MenuItem" mi ON oi."menuItemId" = mi.id
    JOIN "Category" c ON mi."categoryId" = c.id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(oim.price), 0)::float AS mod_total
      FROM "OrderItemModifier" oim
      WHERE oim."orderItemId" = oi.id
    ) mod_totals ON true
    WHERE o."locationId" = ${locationId}
      AND o.status IN ('completed', 'closed', 'paid')
      AND o."deletedAt" IS NULL
      AND oi."deletedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "Order" child WHERE child."parentOrderId" = o.id)
      AND (
        (o."businessDayDate" >= ${range.start} AND o."businessDayDate" <= ${range.end})
        OR (o."businessDayDate" IS NULL AND o."createdAt" >= ${range.start} AND o."createdAt" <= ${range.end})
      )
    GROUP BY c.id, c.name, c."categoryType"
  `)
}

// ─── Category Voids ───────────────────────────────────────────────────────────

/**
 * Voided order items aggregated by category for the business day window.
 */
export async function getCategoryVoids(
  locationId: string,
  range: BusinessDayRange,
): Promise<CategoryVoidsRow[]> {
  return adminDb.$queryRaw<CategoryVoidsRow[]>(Prisma.sql`
    SELECT
      c.id AS category_id,
      COALESCE(SUM(oi.price * oi.quantity), 0)::float AS void_amount
    FROM "OrderItem" oi
    JOIN "Order" o ON oi."orderId" = o.id
    JOIN "MenuItem" mi ON oi."menuItemId" = mi.id
    JOIN "Category" c ON mi."categoryId" = c.id
    WHERE o."locationId" = ${locationId}
      AND o.status = 'voided'
      AND o."deletedAt" IS NULL
      AND oi."deletedAt" IS NULL
      AND (
        (o."businessDayDate" >= ${range.start} AND o."businessDayDate" <= ${range.end})
        OR (o."businessDayDate" IS NULL AND o."createdAt" >= ${range.start} AND o."createdAt" <= ${range.end})
      )
    GROUP BY c.id
  `)
}

// ─── Payment Summary ──────────────────────────────────────────────────────────

/**
 * Payment breakdown by method and card brand for the business day window.
 * Includes count, total, tips, and rounding adjustment per group.
 */
export async function getPaymentSummary(
  locationId: string,
  range: BusinessDayRange,
): Promise<PaymentSummaryRow[]> {
  return adminDb.$queryRaw<PaymentSummaryRow[]>(Prisma.sql`
    SELECT
      p."paymentMethod"::text AS payment_method,
      COALESCE(p."cardBrand", '') AS card_brand,
      COUNT(*)::int AS count,
      COALESCE(SUM(p.amount), 0)::float AS total,
      COALESCE(SUM(p."tipAmount"), 0)::float AS tips,
      COALESCE(SUM(p."roundingAdjustment"), 0)::float AS rounding
    FROM "Payment" p
    JOIN "Order" o ON p."orderId" = o.id
    WHERE o."locationId" = ${locationId}
      AND o.status IN ('completed', 'closed', 'paid')
      AND o."deletedAt" IS NULL
      AND p.status = 'completed'
      AND NOT EXISTS (SELECT 1 FROM "Order" child WHERE child."parentOrderId" = o.id)
      AND (
        (o."businessDayDate" >= ${range.start} AND o."businessDayDate" <= ${range.end})
        OR (o."businessDayDate" IS NULL AND o."createdAt" >= ${range.start} AND o."createdAt" <= ${range.end})
      )
    GROUP BY p."paymentMethod", p."cardBrand"
  `)
}

// ─── Discount Summary ─────────────────────────────────────────────────────────

/**
 * Discount breakdown by discount name for the business day window.
 */
export async function getDiscountSummary(
  locationId: string,
  range: BusinessDayRange,
): Promise<DiscountSummaryRow[]> {
  return adminDb.$queryRaw<DiscountSummaryRow[]>(Prisma.sql`
    SELECT
      COALESCE(dr.name, od.name, 'Unknown') AS discount_name,
      COUNT(*)::int AS count,
      COALESCE(SUM(od.amount), 0)::float AS total
    FROM "OrderDiscount" od
    JOIN "Order" o ON od."orderId" = o.id
    LEFT JOIN "DiscountRule" dr ON od."discountRuleId" = dr.id
    WHERE o."locationId" = ${locationId}
      AND o.status IN ('completed', 'closed', 'paid')
      AND o."deletedAt" IS NULL
      AND od."deletedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "Order" child WHERE child."parentOrderId" = o.id)
      AND (
        (o."businessDayDate" >= ${range.start} AND o."businessDayDate" <= ${range.end})
        OR (o."businessDayDate" IS NULL AND o."createdAt" >= ${range.start} AND o."createdAt" <= ${range.end})
      )
    GROUP BY COALESCE(dr.name, od.name, 'Unknown')
  `)
}

// ─── Weight-Based Sales ───────────────────────────────────────────────────────

/**
 * Weight-based sales aggregated by weight unit for the business day window.
 */
export async function getWeightBasedSales(
  locationId: string,
  range: BusinessDayRange,
): Promise<WeightSummaryRow[]> {
  return adminDb.$queryRaw<WeightSummaryRow[]>(Prisma.sql`
    SELECT
      COALESCE(oi."weightUnit", 'lb') AS weight_unit,
      COALESCE(SUM(oi."itemTotal"), 0)::float AS revenue,
      COALESCE(SUM(oi.quantity), 0)::int AS item_count,
      COALESCE(SUM(oi.weight * oi.quantity), 0)::float AS total_weight
    FROM "OrderItem" oi
    JOIN "Order" o ON oi."orderId" = o.id
    WHERE o."locationId" = ${locationId}
      AND o.status IN ('completed', 'closed', 'paid')
      AND o."deletedAt" IS NULL
      AND oi."deletedAt" IS NULL
      AND oi."soldByWeight" = true
      AND oi.weight IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "Order" child WHERE child."parentOrderId" = o.id)
      AND (
        (o."businessDayDate" >= ${range.start} AND o."businessDayDate" <= ${range.end})
        OR (o."businessDayDate" IS NULL AND o."createdAt" >= ${range.start} AND o."createdAt" <= ${range.end})
      )
    GROUP BY COALESCE(oi."weightUnit", 'lb')
  `)
}

// ─── Entertainment Summary ────────────────────────────────────────────────────

/**
 * Timed rental / entertainment session aggregates for the business day window.
 */
export async function getEntertainmentSummary(
  locationId: string,
  range: BusinessDayRange,
): Promise<EntertainmentSummaryRow> {
  const rows = await adminDb.$queryRaw<EntertainmentSummaryRow[]>(Prisma.sql`
    SELECT
      COUNT(*)::int AS session_count,
      COALESCE(SUM(oi."itemTotal"), 0)::float AS revenue,
      COALESCE(SUM(oi."blockTimeMinutes" * oi.quantity), 0)::int AS total_minutes,
      (
        SELECT mi.name FROM "OrderItem" oi2
        JOIN "MenuItem" mi ON oi2."menuItemId" = mi.id
        JOIN "Order" o2 ON oi2."orderId" = o2.id
        WHERE o2."locationId" = ${locationId}
          AND o2.status IN ('completed', 'closed', 'paid')
          AND o2."deletedAt" IS NULL
          AND oi2."deletedAt" IS NULL
          AND oi2."blockTimeStartedAt" IS NOT NULL
          AND mi."itemType" = 'timed_rental'
          AND (
            (o2."businessDayDate" >= ${range.start} AND o2."businessDayDate" <= ${range.end})
            OR (o2."businessDayDate" IS NULL AND o2."createdAt" >= ${range.start} AND o2."createdAt" <= ${range.end})
          )
        GROUP BY mi.id, mi.name
        ORDER BY SUM(oi2."itemTotal") DESC
        LIMIT 1
      ) AS top_item_name
    FROM "OrderItem" oi
    JOIN "Order" o ON oi."orderId" = o.id
    JOIN "MenuItem" mi ON oi."menuItemId" = mi.id
    WHERE o."locationId" = ${locationId}
      AND o.status IN ('completed', 'closed', 'paid')
      AND o."deletedAt" IS NULL
      AND oi."deletedAt" IS NULL
      AND oi."blockTimeStartedAt" IS NOT NULL
      AND mi."itemType" = 'timed_rental'
      AND NOT EXISTS (SELECT 1 FROM "Order" child WHERE child."parentOrderId" = o.id)
      AND (
        (o."businessDayDate" >= ${range.start} AND o."businessDayDate" <= ${range.end})
        OR (o."businessDayDate" IS NULL AND o."createdAt" >= ${range.start} AND o."createdAt" <= ${range.end})
      )
  `)

  return rows[0] || { session_count: 0, revenue: 0, total_minutes: 0, top_item_name: null }
}

// ─── Surcharge Base ───────────────────────────────────────────────────────────

/**
 * Total subtotal of orders paid by card (for surcharge calculation).
 * Only meaningful when surcharge pricing is active.
 */
export async function getSurchargeBase(
  locationId: string,
  range: BusinessDayRange,
): Promise<number> {
  const rows = await adminDb.$queryRaw<SurchargeOrderRow[]>(Prisma.sql`
    SELECT
      COALESCE(SUM(
        CASE WHEN EXISTS (
          SELECT 1 FROM "Payment" p
          WHERE p."orderId" = o.id
            AND p.status = 'completed'
            AND LOWER(p."paymentMethod"::text) IN ('credit', 'card')
        )
        THEN o.subtotal
        ELSE 0 END
      ), 0)::float AS surcharge_base
    FROM "Order" o
    WHERE o."locationId" = ${locationId}
      AND o.status IN ('completed', 'closed', 'paid')
      AND o."deletedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "Order" child WHERE child."parentOrderId" = o.id)
      AND (
        (o."businessDayDate" >= ${range.start} AND o."businessDayDate" <= ${range.end})
        OR (o."businessDayDate" IS NULL AND o."createdAt" >= ${range.start} AND o."createdAt" <= ${range.end})
      )
  `)

  return Number(rows[0]?.surcharge_base) || 0
}

// ─── Dashboard Live Metrics ───────────────────────────────────────────────────

export interface LiveDashboardOrders {
  id: string
  total: unknown
  subtotal?: unknown
  discountTotal?: unknown
  taxTotal?: unknown
}

/**
 * Fetch today's revenue orders (completed/closed/paid) for live dashboard.
 * Uses businessDayDate with createdAt fallback.
 */
export async function getTodayRevenueOrders(
  locationId: string,
  range: BusinessDayRange,
): Promise<LiveDashboardOrders[]> {
  return adminDb.order.findMany({
    where: {
      locationId,
      deletedAt: null,
      status: { in: [...REVENUE_ORDER_STATUSES] },
      parentOrderId: null,
      OR: [
        { businessDayDate: { gte: range.start, lte: range.end } },
        { businessDayDate: null, createdAt: { gte: range.start, lte: range.end } },
      ],
    },
    select: {
      id: true,
      subtotal: true,
      total: true,
      discountTotal: true,
      taxTotal: true,
    },
  })
}

/**
 * Fetch open orders (open/sent) for live dashboard ticket count and value.
 */
export async function getOpenOrders(
  locationId: string,
): Promise<{ id: string; total: unknown }[]> {
  return adminDb.order.findMany({
    where: {
      locationId,
      deletedAt: null,
      status: { in: ['open', 'sent'] },
    },
    select: {
      id: true,
      total: true,
    },
  })
}

/**
 * Aggregate voided items for the business day window (count + dollar total).
 */
export async function getVoidedItemsAggregate(
  locationId: string,
  range: BusinessDayRange,
): Promise<{ count: number; total: number }> {
  const result = await adminDb.orderItem.aggregate({
    where: {
      locationId,
      deletedAt: null,
      status: 'voided',
      updatedAt: { gte: range.start, lte: range.end },
    },
    _sum: { itemTotal: true },
    _count: { id: true },
  })

  return {
    count: result._count.id || 0,
    total: Number(result._sum.itemTotal || 0),
  }
}

/**
 * Aggregate comped items for the business day window (count + dollar total).
 */
export async function getCompedItemsAggregate(
  locationId: string,
  range: BusinessDayRange,
): Promise<{ count: number; total: number }> {
  const result = await adminDb.orderItem.aggregate({
    where: {
      locationId,
      deletedAt: null,
      status: 'comped',
      updatedAt: { gte: range.start, lte: range.end },
    },
    _sum: { itemTotal: true },
    _count: { id: true },
  })

  return {
    count: result._count.id || 0,
    total: Number(result._sum.itemTotal || 0),
  }
}

/**
 * Aggregate discount totals from orders for the business day window.
 */
export async function getDiscountTotalAggregate(
  locationId: string,
  range: BusinessDayRange,
): Promise<number> {
  const result = await adminDb.order.aggregate({
    where: {
      locationId,
      deletedAt: null,
      status: { in: [...REVENUE_ORDER_STATUSES] },
      OR: [
        { businessDayDate: { gte: range.start, lte: range.end } },
        { businessDayDate: null, createdAt: { gte: range.start, lte: range.end } },
      ],
      discountTotal: { gt: 0 },
    },
    _sum: { discountTotal: true },
  })

  return Number(result._sum.discountTotal || 0)
}

// ─── Void Logs (row-level for breakdown) ──────────────────────────────────────

/**
 * Fetch void logs for the business day window (needed for byReason breakdown).
 * Includes join to order for locationId enforcement.
 */
export async function getVoidLogs(
  locationId: string,
  range: BusinessDayRange,
) {
  return adminDb.voidLog.findMany({
    where: {
      locationId,
      createdAt: { gte: range.start, lte: range.end },
    },
    take: 10000,
  })
}

/**
 * Fetch void logs with employee and order info for the voids report.
 */
export async function getVoidLogsDetailed(
  locationId: string,
  range: BusinessDayRange,
  filters?: { employeeId?: string; voidType?: string },
) {
  const where: Prisma.VoidLogWhereInput = {
    order: { locationId },
    createdAt: { gte: range.start, lte: range.end },
  }

  if (filters?.employeeId) where.employeeId = filters.employeeId
  if (filters?.voidType) where.voidType = filters.voidType as any

  return adminDb.voidLog.findMany({
    where,
    include: {
      order: {
        select: {
          orderNumber: true,
          orderType: true,
          tabName: true,
        },
      },
      employee: {
        select: {
          id: true,
          displayName: true,
          firstName: true,
          lastName: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Batch fetch order item names by ID list (for void report item lookup).
 */
export async function getOrderItemNames(
  itemIds: string[],
): Promise<Map<string, string>> {
  if (itemIds.length === 0) return new Map()

  const items = await adminDb.orderItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, name: true },
  })

  return new Map(items.map(i => [i.id, i.name]))
}

// ─── Paid In/Out ──────────────────────────────────────────────────────────────

/**
 * Fetch paid in/out entries for a date window.
 */
export async function getPaidInOut(
  locationId: string,
  range: BusinessDayRange,
) {
  return adminDb.paidInOut.findMany({
    where: {
      locationId,
      deletedAt: null,
      createdAt: { gte: range.start, lte: range.end },
    },
    select: {
      type: true,
      amount: true,
    },
  })
}

/**
 * Fetch paid in/out totals calculated in-memory.
 * Returns { paidIn, paidOut } in dollars.
 */
export async function getPaidInOutTotals(
  locationId: string,
  range: BusinessDayRange,
): Promise<{ paidIn: number; paidOut: number }> {
  const entries = await getPaidInOut(locationId, range)

  let paidIn = 0
  let paidOut = 0
  for (const pio of entries) {
    const amount = Number(pio.amount || 0)
    if (pio.type === 'in') paidIn += amount
    else paidOut += amount
  }

  return { paidIn, paidOut }
}

// ─── Gift Card Transactions ───────────────────────────────────────────────────

/**
 * Fetch gift card transactions for a date window (daily report).
 */
export async function getGiftCardTransactions(
  locationId: string,
  range: BusinessDayRange,
) {
  return adminDb.giftCardTransaction.findMany({
    where: {
      locationId,
      createdAt: { gte: range.start, lte: range.end },
    },
    take: 10000,
  })
}

// ─── Categories Reference ─────────────────────────────────────────────────────

/**
 * Fetch all categories for a location (reference data for grouping).
 */
export async function getCategories(locationId: string) {
  return adminDb.category.findMany({
    where: { locationId, deletedAt: null },
    select: { id: true, name: true, categoryType: true },
  })
}

// ─── CC Tip Fees ──────────────────────────────────────────────────────────────

/**
 * Aggregate CC tip processing fees for the business day window.
 */
export async function getCCTipFees(
  locationId: string,
  range: BusinessDayRange,
): Promise<{ totalCents: number; transactionCount: number }> {
  const result = await adminDb.tipTransaction.aggregate({
    _sum: { ccFeeAmountCents: true },
    _count: true,
    where: {
      locationId,
      collectedAt: { gte: range.start, lte: range.end },
      ccFeeAmountCents: { gt: 0 },
      deletedAt: null,
    },
  })

  return {
    totalCents: Number(result._sum.ccFeeAmountCents || 0),
    transactionCount: result._count || 0,
  }
}

// ─── Failed Deductions (dashboard) ────────────────────────────────────────────

/**
 * Count failed/dead pending deductions for a location (dashboard widget).
 */
export async function getFailedDeductionCount(
  locationId: string,
): Promise<number> {
  try {
    return await adminDb.pendingDeduction.count({
      where: {
        locationId,
        OR: [
          { status: 'dead' },
          { status: 'failed', attempts: { gt: 3 } },
        ],
      },
    })
  } catch {
    // PendingDeduction model may not be migrated yet
    return 0
  }
}
