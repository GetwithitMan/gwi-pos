/**
 * Tip Compliance Domain Logic (Skill 259)
 *
 * Provides compliance guardrails for tip operations. These functions return
 * warnings that the UI can display — they do NOT block operations.
 *
 * Most functions are pure (no database access). The only async function is
 * `runComplianceChecks()` which loads location settings.
 *
 * All monetary amounts are in CENTS (integers).
 */

import { getLocationTipBankSettings } from './tip-chargebacks'

// ─── Types ───────────────────────────────────────────────────────────────────

export type ComplianceWarningLevel = 'info' | 'warning' | 'critical'

export interface ComplianceWarning {
  code: string
  level: ComplianceWarningLevel
  message: string
  details?: Record<string, unknown>
}

export interface ComplianceCheckResult {
  passed: boolean
  warnings: ComplianceWarning[]
}

export interface ShiftComplianceData {
  employeeId: string
  shiftId: string
  totalSales: number      // in cents
  cashTipsDeclared: number // in cents
  cardTips: number         // in cents
  tipOutsGiven: number     // in cents
  tipOutsReceived: number  // in cents
}

export interface TipOutCheckData {
  fromRoleName: string
  toRoleName: string
  percentage: number
  basisAmount: number  // in cents
  tipOutAmount: number // in cents
}

export interface PoolEligibilityData {
  employeeId: string
  employeeName: string
  roleName: string
  isManager: boolean
}

// ─── Pure Functions ──────────────────────────────────────────────────────────

/**
 * Check tip-out percentages against a maximum cap and verify the total
 * does not exceed 100% of the basis amount.
 *
 * Pure function — no database access.
 *
 * @param params.tipOuts - Array of tip-out rule data to validate
 * @param params.maxPercentage - Maximum allowed percentage per rule (default: 100)
 * @returns Compliance result with any cap or total-exceeded warnings
 */
export function checkTipOutCap(params: {
  tipOuts: TipOutCheckData[]
  maxPercentage?: number
}): ComplianceCheckResult {
  const { tipOuts, maxPercentage = 100 } = params
  const warnings: ComplianceWarning[] = []

  // Check each individual tip-out rule against the cap
  for (const tipOut of tipOuts) {
    if (tipOut.percentage > maxPercentage) {
      warnings.push({
        code: 'TIPOUT_EXCEEDS_CAP',
        level: 'warning',
        message: `Tip-out from ${tipOut.fromRoleName} to ${tipOut.toRoleName} (${tipOut.percentage}%) exceeds the ${maxPercentage}% cap`,
        details: {
          fromRole: tipOut.fromRoleName,
          toRole: tipOut.toRoleName,
          percentage: tipOut.percentage,
          maxPercentage,
        },
      })
    }
  }

  // Check total tip-out percentage does not exceed 100% of basis
  const totalPercentage = tipOuts.reduce((sum, t) => sum + t.percentage, 0)
  if (totalPercentage > 100) {
    warnings.push({
      code: 'TIPOUT_TOTAL_EXCEEDS_100',
      level: 'critical',
      message: `Total tip-out percentage (${totalPercentage}%) exceeds 100% of tip basis`,
      details: {
        totalPercentage,
        rules: tipOuts.map((t) => ({
          fromRole: t.fromRoleName,
          toRole: t.toRoleName,
          percentage: t.percentage,
        })),
      },
    })
  }

  return {
    passed: !warnings.some((w) => w.level === 'critical'),
    warnings,
  }
}

/**
 * Check whether any pool members are managers when the location setting
 * disallows managers in tip pools.
 *
 * Pure function — no database access.
 *
 * @param params.members - Array of pool member data to validate
 * @param params.allowManagerInPools - Location setting controlling manager eligibility
 * @returns Compliance result with a warning if a manager is found
 */
export function checkPoolEligibility(params: {
  members: PoolEligibilityData[]
  allowManagerInPools: boolean
}): ComplianceCheckResult {
  const { members, allowManagerInPools } = params
  const warnings: ComplianceWarning[] = []

  if (!allowManagerInPools) {
    const managers = members.filter((m) => m.isManager)
    for (const mgr of managers) {
      warnings.push({
        code: 'MANAGER_IN_POOL',
        level: 'warning',
        message: `${mgr.employeeName} (${mgr.roleName}) is a manager and may not be eligible for tip pools per location settings`,
        details: {
          employeeId: mgr.employeeId,
          employeeName: mgr.employeeName,
          roleName: mgr.roleName,
        },
      })
    }
  }

  return {
    passed: !warnings.some((w) => w.level === 'critical'),
    warnings,
  }
}

/**
 * Check whether declared cash tips meet the IRS 8% minimum threshold
 * based on total sales.
 *
 * Pure function — no database access.
 *
 * @param params.declaredCashTipsCents - Amount of cash tips declared (cents)
 * @param params.totalSalesCents - Total sales for the shift (cents)
 * @param params.minimumPercent - Minimum required percentage (default: 8 for IRS 8% rule)
 * @returns Compliance result with a warning if declaration falls below minimum
 */
export function checkDeclarationMinimum(params: {
  declaredCashTipsCents: number
  totalSalesCents: number
  minimumPercent?: number
}): ComplianceCheckResult {
  const { declaredCashTipsCents, totalSalesCents, minimumPercent = 8 } = params
  const warnings: ComplianceWarning[] = []

  // No sales = no minimum applies
  if (totalSalesCents === 0) {
    return { passed: true, warnings: [] }
  }

  const minimumCents = Math.round(totalSalesCents * (minimumPercent / 100))

  if (declaredCashTipsCents < minimumCents) {
    warnings.push({
      code: 'DECLARATION_BELOW_MINIMUM',
      level: 'warning',
      message: `Cash tip declaration (${formatCentsForDisplay(declaredCashTipsCents)}) is below IRS ${minimumPercent}% minimum (${formatCentsForDisplay(minimumCents)} based on ${formatCentsForDisplay(totalSalesCents)} in sales)`,
      details: {
        declared: declaredCashTipsCents,
        minimum: minimumCents,
        sales: totalSalesCents,
        percent: minimumPercent,
      },
    })
  }

  return {
    passed: !warnings.some((w) => w.level === 'critical'),
    warnings,
  }
}

// ─── Aggregate Check ─────────────────────────────────────────────────────────

/**
 * Run all applicable compliance checks for a shift closeout.
 *
 * This is the only async function in the module — it loads location settings
 * via `getLocationTipBankSettings()`. All individual checks are delegated
 * to pure functions.
 *
 * @param params.locationId - Location to load settings for
 * @param params.shiftData - Shift-level tip data for declaration check
 * @param params.tipOuts - Optional tip-out rules to validate
 * @param params.poolMembers - Optional pool members to check eligibility
 * @returns Combined compliance result from all checks
 */
export async function runComplianceChecks(params: {
  locationId: string
  shiftData: ShiftComplianceData
  tipOuts?: TipOutCheckData[]
  poolMembers?: PoolEligibilityData[]
}): Promise<ComplianceCheckResult> {
  const { locationId, shiftData, tipOuts, poolMembers } = params

  // ── 1. Load location settings (only async operation) ────────────────────
  const settings = await getLocationTipBankSettings(locationId)

  // ── 2. Collect all warnings ──────────────────────────────────────────────
  const allWarnings: ComplianceWarning[] = []

  // Declaration minimum check
  const declarationResult = checkDeclarationMinimum({
    declaredCashTipsCents: shiftData.cashTipsDeclared,
    totalSalesCents: shiftData.totalSales,
  })
  allWarnings.push(...declarationResult.warnings)

  // Tip-out cap check (if tip-out data provided)
  if (tipOuts && tipOuts.length > 0) {
    const tipOutResult = checkTipOutCap({ tipOuts })
    allWarnings.push(...tipOutResult.warnings)
  }

  // Pool eligibility check (if pool member data provided)
  if (poolMembers && poolMembers.length > 0) {
    const poolResult = checkPoolEligibility({
      members: poolMembers,
      allowManagerInPools: settings.allowManagerInPools,
    })
    allWarnings.push(...poolResult.warnings)
  }

  // ── 3. Determine overall pass/fail ────────────────────────────────────────
  const passed = !allWarnings.some((w) => w.level === 'critical')

  return { passed, warnings: allWarnings }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert a cent amount to a display string (e.g., 1050 -> "$10.50").
 *
 * Pure function.
 *
 * @param cents - Amount in cents (integer)
 * @returns Formatted dollar string with two decimal places
 */
export function formatCentsForDisplay(cents: number): string {
  const dollars = cents / 100
  return `$${dollars.toFixed(2)}`
}
