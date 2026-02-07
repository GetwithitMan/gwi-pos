/**
 * Tip Calculation Domain Logic
 *
 * Pure functions for tip calculations, tip-out rules, and tip distribution.
 * Encapsulates all business rules related to tips.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TipSettings {
  defaultPercentages: number[]
  calculateOn: 'subtotal' | 'total'
  allowCustomTip: boolean
  minimumTip?: number
  maximumTipPercent?: number
  autoGratuityThreshold?: number
  autoGratuityPercent?: number
}

export interface TipOutRule {
  fromRole: string
  toRole: string
  percentage: number
  isActive: boolean
}

export interface TipDistribution {
  employeeId: string
  employeeName: string
  role: string
  tipsEarned: number
  tipOutAmount: number
  tipsReceived: number
  netTips: number
}

// ─── Tip Calculation Functions ───────────────────────────────────────────────

/**
 * Calculate tip amount from percentage
 *
 * @param baseAmount - Amount to calculate tip on (subtotal or total)
 * @param tipPercent - Tip percentage (e.g., 18 for 18%)
 * @returns Tip amount rounded to 2 decimal places
 *
 * @example
 * calculateTipAmount(100.00, 18) // Returns 18.00
 * calculateTipAmount(87.50, 20) // Returns 17.50
 */
export function calculateTipAmount(baseAmount: number, tipPercent: number): number {
  if (baseAmount < 0) {
    throw new Error('Base amount cannot be negative')
  }
  if (tipPercent < 0) {
    throw new Error('Tip percent cannot be negative')
  }

  return Math.round(baseAmount * (tipPercent / 100) * 100) / 100
}

/**
 * Calculate tip percentage from amount
 *
 * @param tipAmount - Tip amount in dollars
 * @param baseAmount - Amount tip was calculated on
 * @returns Tip percentage rounded to 1 decimal place
 *
 * @example
 * calculateTipPercent(18.00, 100.00) // Returns 18.0
 * calculateTipPercent(5.25, 25.00) // Returns 21.0
 */
export function calculateTipPercent(tipAmount: number, baseAmount: number): number {
  if (baseAmount === 0) return 0
  if (tipAmount < 0 || baseAmount < 0) {
    throw new Error('Amounts cannot be negative')
  }

  return Math.round((tipAmount / baseAmount) * 100 * 10) / 10
}

/**
 * Get suggested tip amounts based on percentages
 *
 * @param baseAmount - Amount to calculate tips on
 * @param percentages - Array of tip percentages
 * @returns Array of tip amounts
 *
 * @example
 * getSuggestedTips(100.00, [15, 18, 20, 25])
 * // Returns [15.00, 18.00, 20.00, 25.00]
 */
export function getSuggestedTips(baseAmount: number, percentages: number[]): number[] {
  return percentages.map((percent) => calculateTipAmount(baseAmount, percent))
}

/**
 * Determine if auto-gratuity should apply
 *
 * @param partySize - Number of guests
 * @param subtotal - Order subtotal
 * @param settings - Tip settings with auto-gratuity rules
 * @returns True if auto-gratuity should be applied
 */
export function shouldApplyAutoGratuity(
  partySize: number,
  subtotal: number,
  settings: TipSettings
): boolean {
  if (!settings.autoGratuityThreshold || !settings.autoGratuityPercent) {
    return false
  }

  return partySize >= settings.autoGratuityThreshold
}

/**
 * Calculate auto-gratuity amount
 *
 * @param subtotal - Order subtotal
 * @param settings - Tip settings
 * @returns Auto-gratuity amount or 0 if not applicable
 */
export function calculateAutoGratuity(subtotal: number, settings: TipSettings): number {
  if (!settings.autoGratuityPercent) return 0

  return calculateTipAmount(subtotal, settings.autoGratuityPercent)
}

/**
 * Validate tip amount against settings
 *
 * @param tipAmount - Proposed tip amount
 * @param baseAmount - Base amount for percentage calculation
 * @param settings - Tip settings with min/max rules
 * @returns Validation result with error message if invalid
 */
export function validateTipAmount(
  tipAmount: number,
  baseAmount: number,
  settings: TipSettings
): { valid: boolean; error?: string } {
  if (tipAmount < 0) {
    return { valid: false, error: 'Tip cannot be negative' }
  }

  if (settings.minimumTip && tipAmount > 0 && tipAmount < settings.minimumTip) {
    return {
      valid: false,
      error: `Minimum tip is $${settings.minimumTip.toFixed(2)}`,
    }
  }

  if (settings.maximumTipPercent) {
    const tipPercent = calculateTipPercent(tipAmount, baseAmount)
    if (tipPercent > settings.maximumTipPercent) {
      return {
        valid: false,
        error: `Maximum tip is ${settings.maximumTipPercent}%`,
      }
    }
  }

  return { valid: true }
}

// ─── Tip-Out Calculations ────────────────────────────────────────────────────

/**
 * Calculate tip-out amount based on rules
 *
 * @param tipsEarned - Tips earned by employee
 * @param employeeRole - Employee's role
 * @param rules - Active tip-out rules
 * @returns Total tip-out amount
 *
 * @example
 * calculateTipOut(100.00, 'server', [
 *   { fromRole: 'server', toRole: 'busser', percentage: 3, isActive: true },
 *   { fromRole: 'server', toRole: 'host', percentage: 2, isActive: true },
 * ])
 * // Returns 5.00 (3% + 2% = 5% of $100)
 */
export function calculateTipOut(
  tipsEarned: number,
  employeeRole: string,
  rules: TipOutRule[]
): number {
  const applicableRules = rules.filter(
    (rule) => rule.isActive && rule.fromRole === employeeRole
  )

  const totalTipOutPercent = applicableRules.reduce(
    (sum, rule) => sum + rule.percentage,
    0
  )

  return Math.round(tipsEarned * (totalTipOutPercent / 100) * 100) / 100
}

/**
 * Calculate tip distribution for an employee shift
 *
 * @param tipsEarned - Tips earned during shift
 * @param tipsReceived - Tips received from tip-outs
 * @param employeeRole - Employee's role
 * @param rules - Active tip-out rules
 * @returns Tip distribution breakdown
 */
export function calculateTipDistribution(
  tipsEarned: number,
  tipsReceived: number,
  employeeRole: string,
  rules: TipOutRule[]
): Omit<TipDistribution, 'employeeId' | 'employeeName'> {
  const tipOutAmount = calculateTipOut(tipsEarned, employeeRole, rules)
  const netTips = tipsEarned - tipOutAmount + tipsReceived

  return {
    role: employeeRole,
    tipsEarned,
    tipOutAmount,
    tipsReceived,
    netTips,
  }
}

/**
 * Calculate tip shares for recipients
 *
 * @param tipsEarned - Tips earned by the giver
 * @param giverRole - Role of the tip giver
 * @param rules - Active tip-out rules
 * @returns Map of recipient roles to tip amounts
 *
 * @example
 * calculateTipShares(100.00, 'server', rules)
 * // Returns { busser: 3.00, host: 2.00 }
 */
export function calculateTipShares(
  tipsEarned: number,
  giverRole: string,
  rules: TipOutRule[]
): Record<string, number> {
  const shares: Record<string, number> = {}

  const applicableRules = rules.filter(
    (rule) => rule.isActive && rule.fromRole === giverRole
  )

  for (const rule of applicableRules) {
    const shareAmount = calculateTipAmount(tipsEarned, rule.percentage)
    shares[rule.toRole] = (shares[rule.toRole] || 0) + shareAmount
  }

  return shares
}

// ─── Tip Pooling ─────────────────────────────────────────────────────────────

/**
 * Calculate tip pool distribution
 *
 * @param totalPooledTips - Total tips in the pool
 * @param participants - Array of participants with hours worked
 * @returns Map of employee IDs to tip amounts
 *
 * @example
 * calculateTipPool(200.00, [
 *   { employeeId: 'emp1', hoursWorked: 8 },
 *   { employeeId: 'emp2', hoursWorked: 4 },
 * ])
 * // Returns { emp1: 133.33, emp2: 66.67 }
 */
export function calculateTipPool(
  totalPooledTips: number,
  participants: Array<{ employeeId: string; hoursWorked: number }>
): Record<string, number> {
  const totalHours = participants.reduce((sum, p) => sum + p.hoursWorked, 0)

  if (totalHours === 0) {
    throw new Error('Total hours worked cannot be zero')
  }

  const distribution: Record<string, number> = {}

  for (const participant of participants) {
    const share = (participant.hoursWorked / totalHours) * totalPooledTips
    distribution[participant.employeeId] = Math.round(share * 100) / 100
  }

  // Adjust last participant for rounding
  const distributedTotal = Object.values(distribution).reduce((sum, amt) => sum + amt, 0)
  const remainder = Math.round((totalPooledTips - distributedTotal) * 100) / 100

  if (remainder !== 0 && participants.length > 0) {
    const lastId = participants[participants.length - 1].employeeId
    distribution[lastId] += remainder
  }

  return distribution
}

// ─── Default Settings ────────────────────────────────────────────────────────

/**
 * Default tip settings for new locations
 */
export const DEFAULT_TIP_SETTINGS: TipSettings = {
  defaultPercentages: [15, 18, 20, 25],
  calculateOn: 'subtotal',
  allowCustomTip: true,
  minimumTip: undefined,
  maximumTipPercent: undefined,
  autoGratuityThreshold: 6, // 6+ people
  autoGratuityPercent: 18,
}
