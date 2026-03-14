/**
 * Labor Cost Calculations — PURE functions
 *
 * Centralizes the hardcoded 1.5x overtime multiplier and labor
 * aggregation logic used across labor, payroll, and daily reports.
 *
 * NOTE: The shift-close module's calculateShiftLaborCost() is async
 * (reads DB), so it cannot be re-exported here. This module provides
 * the pure math layer that the DB-aware functions can call into.
 *
 * NO DB access, NO side effects, NO framework imports.
 */

import type { LaborSummary, TimeClockEntryForLabor } from './types'

/** Default overtime multiplier (federal FLSA standard) */
export const DEFAULT_OVERTIME_MULTIPLIER = 1.5

/**
 * Calculate labor cost for a single time clock entry.
 *
 * @param regularHours   Regular (non-overtime) hours worked
 * @param overtimeHours  Overtime hours worked
 * @param hourlyRate     Employee hourly rate in dollars
 * @param overtimeMultiplier  OT multiplier (default 1.5x)
 * @returns Total labor cost in dollars
 */
export function calculateLaborCost(
  regularHours: number,
  overtimeHours: number,
  hourlyRate: number,
  overtimeMultiplier: number = DEFAULT_OVERTIME_MULTIPLIER
): number {
  const regularCost = regularHours * hourlyRate
  const overtimeCost = overtimeHours * hourlyRate * overtimeMultiplier
  return regularCost + overtimeCost
}

/**
 * Aggregate labor summary across multiple time clock entries.
 *
 * Handles Decimal-as-string coercion from Prisma and nullable fields.
 */
export function calculateLaborSummary(
  entries: Array<TimeClockEntryForLabor>,
  overtimeMultiplier: number = DEFAULT_OVERTIME_MULTIPLIER
): LaborSummary {
  let totalRegularHours = 0
  let totalOvertimeHours = 0
  let totalBreakMinutes = 0
  let totalLaborCost = 0

  for (const entry of entries) {
    const regularHours = Number(entry.regularHours) || 0
    const overtimeHours = Number(entry.overtimeHours) || 0
    const hourlyRate = Number(entry.hourlyRate) || 0
    const breakMins = Number(entry.breakMinutes) || 0

    totalRegularHours += regularHours
    totalOvertimeHours += overtimeHours
    totalBreakMinutes += breakMins
    totalLaborCost += calculateLaborCost(regularHours, overtimeHours, hourlyRate, overtimeMultiplier)
  }

  return {
    totalRegularHours,
    totalOvertimeHours,
    totalHours: totalRegularHours + totalOvertimeHours,
    totalBreakMinutes,
    totalLaborCost,
    shiftCount: entries.length,
  }
}
