/**
 * Labor Reporting Query Service
 *
 * Read-only aggregate queries for labor/shift-related reports:
 * - Time clock entries by employee and date range
 * - Labor cost calculations (shift-level and period-level)
 * - Payroll summaries with hours, overtime, breaks
 * - Shift metadata for the payroll report
 *
 * All queries enforce locationId as the first parameter for tenant safety.
 * Uses adminDb (soft-delete filtering only, no tenant scoping overhead).
 */

import { adminDb } from '@/lib/db'
import { REVENUE_ORDER_STATUSES } from '@/lib/constants'
import type { BusinessDayRange } from './order-reporting-queries'

// ─── Time Clock Entry Queries ─────────────────────────────────────────────────

/**
 * Fetch time clock entries for a date range with employee info.
 * Used by the labor report and daily report labor section.
 */
export async function getTimeClockEntries(
  locationId: string,
  range: BusinessDayRange,
  opts?: {
    employeeId?: string | null
    completedOnly?: boolean
  },
) {
  const where: Record<string, unknown> = {
    locationId,
    clockIn: { gte: range.start, lte: range.end },
  }
  if (opts?.employeeId) where.employeeId = opts.employeeId
  if (opts?.completedOnly) where.clockOut = { not: null }

  return adminDb.timeClockEntry.findMany({
    where,
    include: {
      employee: {
        select: {
          id: true,
          displayName: true,
          firstName: true,
          lastName: true,
          hourlyRate: true,
          role: { select: { name: true } },
        },
      },
    },
    orderBy: { clockIn: 'desc' },
  })
}

/**
 * Fetch time clock entries for a shift window (overlapping entries).
 * Used by shift-summary.ts for labor cost calculation.
 * Includes employees still clocked in (clockOut = null).
 */
export async function getOverlappingTimeClockEntries(
  locationId: string,
  startTime: Date,
  endTime: Date,
) {
  return adminDb.timeClockEntry.findMany({
    where: {
      locationId,
      clockIn: { lte: endTime },
      OR: [
        { clockOut: { gte: startTime } },
        { clockOut: null },
      ],
    },
    include: {
      employee: {
        select: { hourlyRate: true },
      },
    },
  })
}

// ─── Employee Queries ─────────────────────────────────────────────────────────

/**
 * Fetch all active employees for a location.
 * Used by the labor report to include employees with no clock entries.
 */
export async function getActiveEmployees(
  locationId: string,
  employeeId?: string | null,
) {
  return adminDb.employee.findMany({
    where: {
      locationId,
      isActive: true,
      ...(employeeId ? { id: employeeId } : {}),
    },
    select: {
      id: true,
      displayName: true,
      firstName: true,
      lastName: true,
      hourlyRate: true,
      role: { select: { name: true } },
    },
  })
}

/**
 * Fetch active employees with role details (for payroll).
 */
export async function getActiveEmployeesWithRoles(
  locationId: string,
  employeeId?: string | null,
) {
  return adminDb.employee.findMany({
    where: {
      locationId,
      isActive: true,
      ...(employeeId ? { id: employeeId } : {}),
    },
    include: {
      role: { select: { id: true, name: true, isTipped: true } },
    },
  })
}

// ─── Shift Queries ────────────────────────────────────────────────────────────

/**
 * Fetch closed shifts in a date range (payroll metadata).
 */
export async function getClosedShifts(
  locationId: string,
  startTime: Date,
  endTime: Date,
  employeeId?: string | null,
) {
  return adminDb.shift.findMany({
    where: {
      locationId,
      status: 'closed',
      startedAt: { gte: startTime, lte: endTime },
      ...(employeeId ? { employeeId } : {}),
    },
    orderBy: { startedAt: 'asc' },
  })
}

// ─── Order Queries for Shift Summary ──────────────────────────────────────────

/**
 * Fetch paid/closed orders by employee during a shift window.
 * Used by shift-summary.ts for sales/commission calculations.
 */
export async function getShiftOrders(
  locationId: string,
  employeeId: string,
  startTime: Date,
  endTime: Date,
) {
  return adminDb.order.findMany({
    where: {
      employeeId,
      locationId,
      createdAt: { gte: startTime, lte: endTime },
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
}

/**
 * Fetch order items with category type for sales breakdown.
 * Used by shift-summary.ts for food/bar sales split.
 */
export async function getOrderItemsByCategoryType(
  orderIds: string[],
) {
  if (orderIds.length === 0) return []

  return adminDb.orderItem.findMany({
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
}

/**
 * Count voided items for orders in a shift window.
 */
export async function countVoidedItemsForShift(
  locationId: string,
  employeeId: string,
  startTime: Date,
  endTime: Date,
): Promise<number> {
  return adminDb.orderItem.count({
    where: {
      order: {
        employeeId,
        locationId,
        createdAt: { gte: startTime, lte: endTime },
      },
      status: 'voided',
    },
  })
}

/**
 * Count comped items for orders in a shift window.
 */
export async function countCompedItemsForShift(
  locationId: string,
  employeeId: string,
  startTime: Date,
  endTime: Date,
): Promise<number> {
  return adminDb.orderItem.count({
    where: {
      order: {
        employeeId,
        locationId,
        createdAt: { gte: startTime, lte: endTime },
      },
      status: 'comped',
    },
  })
}

// ─── Paid In/Out for Shift ────────────────────────────────────────────────────

/**
 * Fetch paid in/out entries for a shift window (drawer-aware or employee-based).
 */
export async function getShiftPaidInOut(
  locationId: string,
  startTime: Date,
  endTime: Date,
  opts: { drawerId?: string | null; employeeId?: string },
) {
  const ownerFilter = opts.drawerId
    ? { drawerId: opts.drawerId }
    : { employeeId: opts.employeeId }

  return adminDb.paidInOut.findMany({
    where: {
      locationId,
      createdAt: { gte: startTime, lte: endTime },
      ...ownerFilter,
    },
  })
}

// ─── Labor Cost as % of Sales ─────────────────────────────────────────────────

/**
 * Fetch total sales (subtotal in cents from OrderSnapshot) for a date range.
 * Used to calculate labor cost as a percentage of sales.
 *
 * Returns total in dollars (divides cents by 100).
 */
export async function getSalesTotalForPeriod(
  locationId: string,
  startDate?: string | null,
  endDate?: string | null,
): Promise<number | null> {
  try {
    const salesFilter: Record<string, unknown> = {
      locationId,
      status: { in: [...REVENUE_ORDER_STATUSES] },
      deletedAt: null,
    }
    if (startDate || endDate) {
      const dateRange: Record<string, Date> = {}
      if (startDate) dateRange.gte = new Date(startDate)
      if (endDate) dateRange.lte = new Date(endDate + 'T23:59:59')
      salesFilter.OR = [
        { businessDayDate: dateRange },
        { businessDayDate: null, createdAt: dateRange },
      ]
    }

    const salesAgg = await adminDb.orderSnapshot.aggregate({
      where: salesFilter,
      _sum: { subtotalCents: true },
    })

    const totalSales = (salesAgg._sum.subtotalCents || 0) / 100
    return totalSales > 0 ? totalSales : null
  } catch {
    return null
  }
}

// ─── Commission Queries ───────────────────────────────────────────────────────

/**
 * Fetch order snapshots with commission totals for a date range.
 * Used by the payroll report.
 */
export async function getCommissionOrders(
  locationId: string,
  startTime: Date,
  endTime: Date,
  employeeId?: string | null,
) {
  return adminDb.orderSnapshot.findMany({
    where: {
      locationId,
      deletedAt: null,
      status: { in: [...REVENUE_ORDER_STATUSES] },
      commissionTotal: { gt: 0 },
      ...(employeeId ? { employeeId } : {}),
      OR: [
        { businessDayDate: { gte: startTime, lte: endTime } },
        { businessDayDate: null, createdAt: { gte: startTime, lte: endTime } },
      ],
    },
  })
}

// ─── Payroll Time Entries (simpler select, no employee include) ───────────────

/**
 * Fetch time clock entries for payroll (no employee include, just raw data).
 */
export async function getPayrollTimeEntries(
  locationId: string,
  startTime: Date,
  endTime: Date,
  employeeId?: string | null,
) {
  return adminDb.timeClockEntry.findMany({
    where: {
      locationId,
      clockIn: { gte: startTime, lte: endTime },
      ...(employeeId ? { employeeId } : {}),
    },
    orderBy: { clockIn: 'asc' },
  })
}
