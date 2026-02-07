/**
 * Domain-specific error types for GWI POS
 *
 * These narrow error types allow for:
 * - Better error handling and recovery logic
 * - Clearer error messages to users
 * - Consistent HTTP status code mapping
 */

/**
 * Base class for all POS domain errors
 */
export abstract class POSError extends Error {
  abstract readonly code: string
  abstract readonly httpStatus: number
  abstract readonly isRetryable: boolean

  constructor(
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = this.constructor.name
    Object.setPrototypeOf(this, new.target.prototype) // Fix prototype chain for ES5 targets
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      isRetryable: this.isRetryable,
    }
  }
}

/**
 * Location not found in database
 */
export class LocationNotFoundError extends POSError {
  readonly code = 'LOCATION_NOT_FOUND'
  readonly httpStatus = 404
  readonly isRetryable = false

  constructor(locationId: string) {
    super(`Location not found: ${locationId}`, { locationId })
  }
}

/**
 * Payment reader/terminal not found in database
 */
export class ReaderNotFoundError extends POSError {
  readonly code = 'READER_NOT_FOUND'
  readonly httpStatus = 404
  readonly isRetryable = false

  constructor(readerId: string) {
    super(`Payment reader not found: ${readerId}`, { readerId })
  }
}

/**
 * Payment processor not configured for location
 */
export class PaymentProcessorNotConfiguredError extends POSError {
  readonly code = 'PAYMENT_PROCESSOR_NOT_CONFIGURED'
  readonly httpStatus = 400
  readonly isRetryable = false

  constructor(locationId: string, message?: string) {
    super(
      message || `Payment processor not configured for location ${locationId}`,
      { locationId }
    )
  }
}

/**
 * Datacap request timeout
 */
export class DatacapTimeoutError extends POSError {
  readonly code = 'DATACAP_TIMEOUT'
  readonly httpStatus = 504
  readonly isRetryable = true

  constructor(
    operationName: string,
    timeoutMs: number,
    public readonly readerId?: string
  ) {
    super(`Datacap ${operationName} timed out after ${timeoutMs}ms`, {
      operation: operationName,
      timeout: timeoutMs,
      readerId,
    })
  }
}

/**
 * Datacap network error (connection refused, unreachable, etc.)
 */
export class DatacapNetworkError extends POSError {
  readonly code: string
  readonly httpStatus = 503
  readonly isRetryable = true

  constructor(
    message: string,
    public readonly originalError: unknown,
    public readonly readerId?: string
  ) {
    super(message, { readerId })

    // Classify error type
    if (originalError instanceof Error) {
      const errorCode = (originalError as Error & { code?: string }).code
      if (errorCode === 'ECONNREFUSED') {
        this.code = 'DATACAP_CONNECTION_REFUSED'
      } else if (errorCode === 'ENETUNREACH') {
        this.code = 'DATACAP_NETWORK_UNREACHABLE'
      } else if (errorCode === 'ETIMEDOUT') {
        this.code = 'DATACAP_TIMEOUT'
      } else if (errorCode === 'ENOTFOUND') {
        this.code = 'DATACAP_HOST_NOT_FOUND'
      } else {
        this.code = 'DATACAP_NETWORK_ERROR'
      }
    } else {
      this.code = 'DATACAP_NETWORK_ERROR'
    }
  }
}

/**
 * Datacap response parsing error
 */
export class DatacapParseError extends POSError {
  readonly code = 'DATACAP_PARSE_ERROR'
  readonly httpStatus = 500
  readonly isRetryable = false

  constructor(
    message: string,
    public readonly rawResponse?: string
  ) {
    super(message, { rawResponse: rawResponse?.slice(0, 200) }) // Truncate for logging
  }
}

/**
 * Datacap transaction declined by processor
 */
export class DatacapDeclinedError extends POSError {
  readonly code = 'DATACAP_DECLINED'
  readonly httpStatus = 402 // Payment Required
  readonly isRetryable = false

  constructor(
    public readonly declineReason?: string,
    public readonly responseCode?: string
  ) {
    super(declineReason || 'Transaction declined', {
      declineReason,
      responseCode,
    })
  }
}

/**
 * Invalid payment amount
 */
export class InvalidPaymentAmountError extends POSError {
  readonly code = 'INVALID_PAYMENT_AMOUNT'
  readonly httpStatus = 400
  readonly isRetryable = false

  constructor(amount: number, reason: string) {
    super(`Invalid payment amount: ${amount} - ${reason}`, { amount, reason })
  }
}

/**
 * Payment method not supported
 */
export class UnsupportedPaymentMethodError extends POSError {
  readonly code = 'UNSUPPORTED_PAYMENT_METHOD'
  readonly httpStatus = 400
  readonly isRetryable = false

  constructor(method: string) {
    super(`Unsupported payment method: ${method}`, { method })
  }
}

/**
 * Map POSError to HTTP response
 */
export function errorToResponse(error: POSError) {
  return {
    error: error.message,
    code: error.code,
    details: error.details,
    isRetryable: error.isRetryable,
  }
}

/**
 * Map error to HTTP status code
 */
export function getErrorStatus(error: unknown): number {
  if (error instanceof POSError) {
    return error.httpStatus
  }
  return 500 // Internal server error for unknown errors
}
