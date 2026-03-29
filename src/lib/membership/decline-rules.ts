/**
 * Datacap DSIX return-code → decline classification mapping.
 * Used by billing processor + dunning to decide retry vs cancel.
 *
 * DSIX codes are 6-digit strings:
 *   000xxx = Approvals
 *   001xxx = Issuer declines
 *   002xxx = Processing errors
 *   003xxx = Device/communication errors
 *   004xxx = Configuration errors
 *
 * The billing processor receives the full 6-digit code from PayAPI.
 * We match on full DSIX codes first, then fall back to the last 2-digit
 * suffix for legacy/short-code compatibility.
 */
import type { DeclineClassification } from './types'

// ── Hard declines (6-digit DSIX) — do NOT retry, card is permanently invalid ──
const HARD_DECLINE_DSIX: Record<string, string> = {
  '001001': 'Declined — generic issuer decline',
  '001002': 'Declined — refer to issuer (voice auth required)',
  '001003': 'Invalid merchant configuration',
  '001004': 'Pick up card — possible fraud/stolen',
  '001005': 'Do not honor — issuer declined',
  '001007': 'Pick up card — fraud flag',
  '001012': 'Invalid transaction type for this card',
  '001015': 'No such issuer — BIN not recognized',
  '001041': 'Lost card — reported lost by cardholder',
  '001043': 'Stolen card — reported stolen',
  '001054': 'Expired card',
  '001057': 'Transaction not permitted for cardholder',
  '001058': 'Transaction not permitted at terminal',
  '001059': 'Suspected fraud',
  '001062': 'Restricted card — blocked by issuer',
  '001063': 'Security violation',
  '001075': 'PIN tries exceeded — card locked',
  '001078': 'Deactivated card',
  '001099': 'Duplicate transaction',
}

// ── Soft declines (6-digit DSIX) — safe to retry after delay ──────────────────
const SOFT_DECLINE_DSIX: Record<string, string> = {
  '001006': 'Issuer processing error — retry may work',
  '001010': 'Partial approval only',
  '001013': 'Invalid amount — check total',
  '001014': 'Invalid card number — re-enter',
  '001019': 'Re-enter transaction — processor requests retry',
  '001028': 'File temporarily unavailable',
  '001051': 'Insufficient funds',
  '001055': 'Invalid PIN — retry with correct PIN',
  '001061': 'Exceeds withdrawal limit',
  '001065': 'Over credit limit',
  '001091': 'Issuer unavailable — try again',
  '001096': 'System malfunction — try again',
}

// ── Processor / network errors (6-digit DSIX) — retry with backoff ────────────
const PROCESSOR_ERROR_DSIX: Record<string, string> = {
  '002001': 'Processing error — generic',
  '002002': 'Invalid data in request',
  '002003': 'Record/token not found',
  '002004': 'Duplicate record',
  '002005': 'Format error in request',
}

// ── Legacy 2-digit fallback codes (from older integrations) ───────────────────
const HARD_DECLINE_SHORT: Record<string, string> = {
  '05': 'Do not honor',
  '14': 'Invalid card number',
  '43': 'Stolen card — pick up',
  '46': 'Closed account',
  '59': 'Suspected fraud',
  '63': 'Security violation',
}

const SOFT_DECLINE_SHORT: Record<string, string> = {
  '51': 'Insufficient funds',
  '61': 'Exceeds withdrawal limit',
  '65': 'Activity count limit exceeded',
  '91': 'Issuer unavailable — try again',
  '96': 'System malfunction — try again',
}

const PROCESSOR_ERROR_SHORT: Record<string, string> = {
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

  // ── Try full 6-digit DSIX codes first ───────────────────────────────────
  if (HARD_DECLINE_DSIX[code]) {
    return {
      category: 'hard_decline',
      retryable: false,
      message: HARD_DECLINE_DSIX[code],
    }
  }

  if (SOFT_DECLINE_DSIX[code]) {
    return {
      category: 'soft_decline',
      retryable: true,
      message: SOFT_DECLINE_DSIX[code],
    }
  }

  if (PROCESSOR_ERROR_DSIX[code]) {
    return {
      category: 'processor_error',
      retryable: true,
      message: PROCESSOR_ERROR_DSIX[code],
    }
  }

  // ── 004xxx = Configuration errors — non-retryable ───────────────────────
  if (code.startsWith('004')) {
    return {
      category: 'config_error',
      retryable: false,
      message: responseMessage || `Configuration error (code: ${code})`,
    }
  }

  // ── 003xxx = Device/communication errors — retryable ────────────────────
  if (code.startsWith('003')) {
    return {
      category: 'processor_error',
      retryable: true,
      message: responseMessage || `Communication error (code: ${code})`,
    }
  }

  // ── Fallback: try short 2-digit codes (last 2 digits of DSIX) ──────────
  const shortCode = code.length >= 2 ? code.slice(-2) : code

  if (HARD_DECLINE_SHORT[shortCode]) {
    return {
      category: 'hard_decline',
      retryable: false,
      message: HARD_DECLINE_SHORT[shortCode],
    }
  }

  if (SOFT_DECLINE_SHORT[shortCode]) {
    return {
      category: 'soft_decline',
      retryable: true,
      message: SOFT_DECLINE_SHORT[shortCode],
    }
  }

  if (PROCESSOR_ERROR_SHORT[shortCode]) {
    return {
      category: 'processor_error',
      retryable: true,
      message: PROCESSOR_ERROR_SHORT[shortCode],
    }
  }

  // Config errors detected by response message content
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
