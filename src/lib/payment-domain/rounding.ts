/**
 * Cash Rounding Domain Logic
 *
 * Pure functions for cash rounding calculations.
 * Extracted for testability and to prevent cash register errors.
 *
 * Business Rules:
 * - Nickel rounding: Round to nearest $0.05
 * - Dime rounding: Round to nearest $0.10
 * - Quarter rounding: Round to nearest $0.25
 * - Dollar rounding: Round to nearest $1.00
 * - Direction: 'up' (ceiling), 'down' (floor), or 'nearest' (standard rounding)
 */

import type { PaymentSettings } from '../settings'

export type RoundingMode = PaymentSettings['cashRounding']
export type RoundingDirection = PaymentSettings['roundingDirection']

/**
 * Rounding increments for each mode
 */
const ROUNDING_VALUES: Record<Exclude<RoundingMode, 'none'>, number> = {
  nickel: 0.05,
  dime: 0.10,
  quarter: 0.25,
  dollar: 1.00,
}

/**
 * Round an amount according to cash rounding rules
 *
 * @param amount - Original amount before rounding
 * @param mode - Rounding mode (nickel, dime, quarter, dollar, or none)
 * @param direction - Rounding direction (up, down, or nearest)
 * @returns Rounded amount
 *
 * @example
 * roundAmount(12.37, 'nickel', 'nearest') // 12.35
 * roundAmount(12.37, 'nickel', 'up')      // 12.40
 * roundAmount(12.37, 'nickel', 'down')    // 12.35
 * roundAmount(12.37, 'dime', 'nearest')   // 12.40
 * roundAmount(12.37, 'quarter', 'up')     // 12.50
 */
export function roundAmount(
  amount: number,
  mode: RoundingMode,
  direction: RoundingDirection
): number {
  // No rounding
  if (mode === 'none') return amount

  const roundTo = ROUNDING_VALUES[mode]

  switch (direction) {
    case 'up':
      return Math.ceil(amount / roundTo) * roundTo
    case 'down':
      return Math.floor(amount / roundTo) * roundTo
    case 'nearest':
    default:
      return Math.round(amount / roundTo) * roundTo
  }
}

/**
 * Calculate the rounding adjustment (difference between rounded and original amount)
 *
 * Positive value = customer pays more (rounded up)
 * Negative value = customer pays less (rounded down)
 *
 * @param originalAmount - Original amount before rounding
 * @param mode - Rounding mode
 * @param direction - Rounding direction
 * @returns Adjustment amount (rounded to 2 decimal places)
 *
 * @example
 * calculateRoundingAdjustment(12.37, 'nickel', 'nearest') // -0.02 (pays $12.35)
 * calculateRoundingAdjustment(12.37, 'nickel', 'up')      //  0.03 (pays $12.40)
 */
export function calculateRoundingAdjustment(
  originalAmount: number,
  mode: RoundingMode,
  direction: RoundingDirection
): number {
  const rounded = roundAmount(originalAmount, mode, direction)
  return Math.round((rounded - originalAmount) * 100) / 100
}

/**
 * Apply rounding to an amount and return both the rounded amount and adjustment
 *
 * @param originalAmount - Original amount
 * @param mode - Rounding mode
 * @param direction - Rounding direction
 * @returns Object with rounded amount and adjustment
 *
 * @example
 * applyRounding(12.37, 'nickel', 'up')
 * // { roundedAmount: 12.40, adjustment: 0.03 }
 */
export function applyRounding(
  originalAmount: number,
  mode: RoundingMode,
  direction: RoundingDirection
): { roundedAmount: number; adjustment: number } {
  const roundedAmount = roundAmount(originalAmount, mode, direction)
  const adjustment = Math.round((roundedAmount - originalAmount) * 100) / 100

  return {
    roundedAmount,
    adjustment,
  }
}

/**
 * Validate rounding configuration
 *
 * @param mode - Rounding mode to validate
 * @param direction - Rounding direction to validate
 * @returns true if valid, throws error if invalid
 */
export function validateRoundingConfig(
  mode: string,
  direction: string
): boolean {
  const validModes = ['none', 'nickel', 'dime', 'quarter', 'dollar']
  const validDirections = ['up', 'down', 'nearest']

  if (!validModes.includes(mode)) {
    throw new Error(`Invalid rounding mode: ${mode}. Must be one of: ${validModes.join(', ')}`)
  }

  if (!validDirections.includes(direction)) {
    throw new Error(`Invalid rounding direction: ${direction}. Must be one of: ${validDirections.join(', ')}`)
  }

  return true
}
