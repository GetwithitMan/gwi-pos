/**
 * Currency Input Utilities
 *
 * Shared validation for cash/tip/currency number inputs.
 * Blocks scientific notation characters and negative values.
 */

const BLOCKED_KEYS = new Set(['e', 'E', '+', '-'])

/**
 * onKeyDown handler for currency/cash number inputs.
 * Blocks: e, E, +, - (prevents scientific notation and negatives).
 */
export function blockCurrencyKeys(e: React.KeyboardEvent<HTMLInputElement>): void {
  if (BLOCKED_KEYS.has(e.key)) {
    e.preventDefault()
  }
}

/**
 * Common props to spread onto a <input type="number"> for currency entry.
 */
export const currencyInputProps = {
  min: 0,
  max: 9999.99,
  step: '0.01',
  onKeyDown: blockCurrencyKeys,
} as const
