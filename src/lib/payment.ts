// Payment Utilities
// Skill 30: Payment Processing

import type { PaymentSettings } from './settings'

// Re-export rounding functions from domain module
// This maintains backward compatibility while keeping logic in dedicated module
export {
  roundAmount,
  calculateRoundingAdjustment,
  applyRounding,
  validateRoundingConfig,
  type RoundingMode,
  type RoundingDirection,
} from './payment-domain/rounding'

// Calculate change for cash payment
export function calculateChange(amountDue: number, amountTendered: number): number {
  const change = amountTendered - amountDue
  return Math.max(0, Math.round(change * 100) / 100)
}

// Quick cash amounts (for buttons)
export function getQuickCashAmounts(amountDue: number): number[] {
  const amounts: number[] = []

  // Exact amount
  amounts.push(amountDue)

  // Round up to nearest $5
  const roundTo5 = Math.ceil(amountDue / 5) * 5
  if (roundTo5 > amountDue) amounts.push(roundTo5)

  // Round up to nearest $10
  const roundTo10 = Math.ceil(amountDue / 10) * 10
  if (roundTo10 > roundTo5) amounts.push(roundTo10)

  // Round up to nearest $20
  const roundTo20 = Math.ceil(amountDue / 20) * 20
  if (roundTo20 > roundTo10) amounts.push(roundTo20)

  // $50 and $100 if applicable
  if (amountDue < 50 && !amounts.includes(50)) amounts.push(50)
  if (amountDue < 100 && !amounts.includes(100)) amounts.push(100)

  // Sort and return unique amounts
  return [...new Set(amounts)].sort((a, b) => a - b).slice(0, 5)
}

// Generate fake auth code for simulated payments
export function generateFakeAuthCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

// Generate fake transaction ID
export function generateFakeTransactionId(): string {
  return `SIM_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// Validate card last 4 digits
export function isValidLast4(last4: string): boolean {
  return /^\d{4}$/.test(last4)
}

// Card brand options
export const CARD_BRANDS = [
  { value: 'visa', label: 'Visa' },
  { value: 'mastercard', label: 'Mastercard' },
  { value: 'amex', label: 'American Express' },
  { value: 'discover', label: 'Discover' },
] as const

export type CardBrand = typeof CARD_BRANDS[number]['value']

// Payment method labels
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  credit: 'Credit Card',
  debit: 'Debit Card',
  gift_card: 'Gift Card',
  house_account: 'House Account',
}

// Calculate tip amount from percentage
export function calculateTip(
  subtotal: number,
  tipPercent: number,
  calculateOn: 'subtotal' | 'total',
  total?: number
): number {
  const base = calculateOn === 'total' && total ? total : subtotal
  return Math.round(base * (tipPercent / 100) * 100) / 100
}

// Calculate tip percentage from amount
export function calculateTipPercent(
  tipAmount: number,
  subtotal: number,
  calculateOn: 'subtotal' | 'total',
  total?: number
): number {
  const base = calculateOn === 'total' && total ? total : subtotal
  if (base === 0) return 0
  return Math.round((tipAmount / base) * 100 * 10) / 10
}

// Check if order is fully paid
export function isFullyPaid(
  orderTotal: number,
  payments: { totalAmount: number; status: string }[]
): boolean {
  const paidAmount = payments
    .filter(p => p.status === 'completed')
    .reduce((sum, p) => sum + Number(p.totalAmount), 0)
  return paidAmount >= orderTotal
}

// Calculate remaining balance
export function calculateRemainingBalance(
  orderTotal: number,
  payments: { totalAmount: number; status: string }[]
): number {
  const paidAmount = payments
    .filter(p => p.status === 'completed')
    .reduce((sum, p) => sum + Number(p.totalAmount), 0)
  return Math.max(0, Math.round((orderTotal - paidAmount) * 100) / 100)
}

// Pre-auth expiration date
export function calculatePreAuthExpiration(days: number = 7): Date {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date
}

// Check if pre-auth is expired
export function isPreAuthExpired(expiresAt: Date | string | null): boolean {
  if (!expiresAt) return true
  const expiration = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt
  return expiration < new Date()
}

// Format card display
export function formatCardDisplay(brand: string | null, last4: string | null): string {
  if (!last4) return 'No card'
  const brandLabel = brand ? CARD_BRANDS.find(b => b.value === brand)?.label || brand : 'Card'
  return `${brandLabel} ****${last4}`
}
