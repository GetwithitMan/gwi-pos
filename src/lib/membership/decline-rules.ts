/**
 * Datacap return-code → decline classification mapping.
 * Used by dunning to decide retry vs cancel.
 */
import type { DeclineClassification } from './types'

// Hard declines — do NOT retry, card is permanently invalid
const HARD_DECLINE_CODES: Record<string, string> = {
  '05': 'Do not honor',
  '14': 'Invalid card number',
  '43': 'Stolen card — pick up',
  '46': 'Closed account',
  '59': 'Suspected fraud',
  '63': 'Security violation',
}

// Soft declines — safe to retry after delay
const SOFT_DECLINE_CODES: Record<string, string> = {
  '51': 'Insufficient funds',
  '61': 'Exceeds withdrawal limit',
  '65': 'Activity count limit exceeded',
  '91': 'Issuer unavailable — try again',
  '96': 'System malfunction — try again',
}

// Processor / network errors — retry with backoff
const PROCESSOR_ERROR_CODES: Record<string, string> = {
  '06': 'Error — general processor error',
  '12': 'Invalid transaction',
  '68': 'Response received too late',
  '92': 'Financial institution not found',
}

export function classifyDecline(
  returnCode: string | null | undefined,
  responseMessage?: string | null
): DeclineClassification {
  const code = (returnCode ?? '').trim()

  if (HARD_DECLINE_CODES[code]) {
    return {
      category: 'hard_decline',
      retryable: false,
      message: HARD_DECLINE_CODES[code],
    }
  }

  if (SOFT_DECLINE_CODES[code]) {
    return {
      category: 'soft_decline',
      retryable: true,
      message: SOFT_DECLINE_CODES[code],
    }
  }

  if (PROCESSOR_ERROR_CODES[code]) {
    return {
      category: 'processor_error',
      retryable: true,
      message: PROCESSOR_ERROR_CODES[code],
    }
  }

  // Config errors (merchant setup issues)
  if (responseMessage && /terminal|merchant|config/i.test(responseMessage)) {
    return {
      category: 'config_error',
      retryable: false,
      message: responseMessage,
    }
  }

  // Unknown — default to soft (retryable) to avoid premature cancellation
  return {
    category: 'unknown',
    retryable: true,
    message: responseMessage || `Unknown decline (code: ${code || 'none'})`,
  }
}
