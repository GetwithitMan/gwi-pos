/**
 * Payment Domain Validators
 *
 * Validation functions for payment domain objects and business rules.
 * All validators return detailed error messages for better UX.
 */

import type { PaymentInput } from '@/lib/services/payment-service'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

// ─── Payment Validation ──────────────────────────────────────────────────────

/**
 * Validate a single payment input
 *
 * @param payment - Payment input to validate
 * @param orderTotal - Order total for validation
 * @returns Validation result with errors
 */
export function validatePayment(
  payment: PaymentInput,
  orderTotal: number
): ValidationResult {
  const errors: string[] = []

  // Amount validation
  if (typeof payment.amount !== 'number' || isNaN(payment.amount)) {
    errors.push('Payment amount must be a valid number')
  } else if (payment.amount <= 0) {
    errors.push('Payment amount must be greater than zero')
  } else if (payment.amount > orderTotal * 2) {
    errors.push(`Payment amount ($${payment.amount.toFixed(2)}) is unreasonably high`)
  }

  // Tip validation
  if (payment.tipAmount !== undefined) {
    if (typeof payment.tipAmount !== 'number' || isNaN(payment.tipAmount)) {
      errors.push('Tip amount must be a valid number')
    } else if (payment.tipAmount < 0) {
      errors.push('Tip amount cannot be negative')
    } else if (payment.tipAmount > payment.amount * 2) {
      errors.push('Tip amount seems unreasonably high')
    }
  }

  // Method-specific validation
  switch (payment.method) {
    case 'cash':
      if (payment.amountTendered !== undefined) {
        if (payment.amountTendered < payment.amount) {
          errors.push('Cash tendered is less than payment amount')
        }
      }
      break

    case 'credit':
    case 'debit':
      // Card payments should have Datacap fields if processed
      if (payment.datacapRecordNo && !payment.cardLast4) {
        errors.push('Card payment missing card last 4 digits')
      }
      break

    case 'gift_card':
      if (!payment.giftCardNumber) {
        errors.push('Gift card payment missing card number')
      } else if (payment.giftCardNumber.length < 10) {
        errors.push('Gift card number is too short')
      }
      break

    case 'house_account':
      if (!payment.houseAccountId) {
        errors.push('House account payment missing account ID')
      }
      break

    default:
      errors.push(`Unknown payment method: ${payment.method}`)
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Validate multiple payments against order total
 *
 * @param payments - Array of payments to validate
 * @param orderTotal - Order total
 * @param existingPayments - Existing completed payments
 * @returns Validation result
 */
export function validatePayments(
  payments: PaymentInput[],
  orderTotal: number,
  existingPayments: Array<{ amount: number; status: string }> = []
): ValidationResult {
  const errors: string[] = []

  // Must have at least one payment
  if (payments.length === 0) {
    errors.push('At least one payment is required')
    return { valid: false, errors }
  }

  // Validate each payment individually
  for (let i = 0; i < payments.length; i++) {
    const paymentResult = validatePayment(payments[i], orderTotal)
    if (!paymentResult.valid) {
      errors.push(`Payment ${i + 1}: ${paymentResult.errors.join(', ')}`)
    }
  }

  // Calculate totals
  const previouslyPaid = existingPayments
    .filter((p) => p.status === 'completed')
    .reduce((sum, p) => sum + p.amount, 0)

  const newPaymentsTotal = payments.reduce((sum, p) => sum + p.amount, 0)
  const totalPaid = previouslyPaid + newPaymentsTotal

  // Check if total payments match order total
  const diff = Math.abs(totalPaid - orderTotal)
  if (diff > 0.01) {
    // Allow 1 cent rounding difference
    if (totalPaid < orderTotal) {
      errors.push(
        `Insufficient payment: $${totalPaid.toFixed(2)} paid, $${orderTotal.toFixed(2)} required`
      )
    } else {
      errors.push(
        `Overpayment: $${totalPaid.toFixed(2)} paid, $${orderTotal.toFixed(2)} required`
      )
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

// ─── Amount Validation ───────────────────────────────────────────────────────

/**
 * Validate a monetary amount
 *
 * @param amount - Amount to validate
 * @param fieldName - Name of field for error messages
 * @param options - Validation options
 * @returns Validation result
 */
export function validateAmount(
  amount: number,
  fieldName: string,
  options: {
    allowZero?: boolean
    allowNegative?: boolean
    maximum?: number
    minimum?: number
  } = {}
): ValidationResult {
  const errors: string[] = []

  if (typeof amount !== 'number' || isNaN(amount)) {
    errors.push(`${fieldName} must be a valid number`)
    return { valid: false, errors }
  }

  if (!options.allowZero && amount === 0) {
    errors.push(`${fieldName} cannot be zero`)
  }

  if (!options.allowNegative && amount < 0) {
    errors.push(`${fieldName} cannot be negative`)
  }

  if (options.minimum !== undefined && amount < options.minimum) {
    errors.push(`${fieldName} must be at least $${options.minimum.toFixed(2)}`)
  }

  if (options.maximum !== undefined && amount > options.maximum) {
    errors.push(`${fieldName} cannot exceed $${options.maximum.toFixed(2)}`)
  }

  // Check for excessive decimal places
  const decimalPlaces = (amount.toString().split('.')[1] || '').length
  if (decimalPlaces > 2) {
    errors.push(`${fieldName} cannot have more than 2 decimal places`)
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

// ─── Split Payment Validation ────────────────────────────────────────────────

/**
 * Validate split payment configuration
 *
 * @param orderTotal - Order total to split
 * @param ways - Number of ways to split
 * @returns Validation result
 */
export function validateSplitPayment(orderTotal: number, ways: number): ValidationResult {
  const errors: string[] = []

  if (!Number.isInteger(ways) || ways < 2) {
    errors.push('Split must be at least 2 ways')
  }

  if (ways > 10) {
    errors.push('Cannot split more than 10 ways')
  }

  if (orderTotal / ways < 0.01) {
    errors.push('Split amount would be less than 1 cent')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

// ─── Refund Validation ───────────────────────────────────────────────────────

/**
 * Validate a refund request
 *
 * @param refundAmount - Amount to refund
 * @param originalPaymentAmount - Original payment amount
 * @param previousRefunds - Previous refund amounts
 * @returns Validation result
 */
export function validateRefund(
  refundAmount: number,
  originalPaymentAmount: number,
  previousRefunds: number[] = []
): ValidationResult {
  const errors: string[] = []

  const amountValidation = validateAmount(refundAmount, 'Refund amount')
  if (!amountValidation.valid) {
    return amountValidation
  }

  const totalRefunded = previousRefunds.reduce((sum, amt) => sum + amt, 0)
  const maxRefundable = originalPaymentAmount - totalRefunded

  if (refundAmount > maxRefundable) {
    errors.push(
      `Cannot refund $${refundAmount.toFixed(2)}. Maximum refundable: $${maxRefundable.toFixed(2)}`
    )
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Combine multiple validation results
 */
export function combineValidations(...results: ValidationResult[]): ValidationResult {
  const allErrors = results.flatMap((r) => r.errors)

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
  }
}

/**
 * Check if validation result is valid (type guard)
 */
export function isValid(result: ValidationResult): result is { valid: true; errors: [] } {
  return result.valid
}
