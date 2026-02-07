/**
 * Error Capture Utility
 *
 * Centralized error logging service for GWI POS.
 * Captures errors with rich context and sends to monitoring API.
 *
 * Usage:
 * ```typescript
 * import { errorCapture } from '@/lib/error-capture'
 *
 * try {
 *   await processPayment(orderId)
 * } catch (error) {
 *   await errorCapture.log({
 *     severity: 'CRITICAL',
 *     errorType: 'PAYMENT',
 *     category: 'payment-timeout',
 *     message: 'Payment processor timeout',
 *     action: `Processing payment for Order #${orderNumber}`,
 *     orderId,
 *     error, // Automatically extracts stack trace
 *   })
 *   throw error // Re-throw if needed
 * }
 * ```
 */

// ============================================
// Type Definitions
// ============================================

export type ErrorSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

export type ErrorType =
  | 'PAYMENT'       // Payment processing errors (CRITICAL PATH)
  | 'ORDER'         // Order creation/update errors (CRITICAL PATH)
  | 'API'           // API route errors
  | 'FRONTEND'      // React component errors
  | 'DATABASE'      // Database query errors
  | 'NETWORK'       // Network/connectivity errors
  | 'BUSINESS_LOGIC' // Validation, business rule violations
  | 'PERFORMANCE'   // Slow operations

export interface ErrorCaptureData {
  // Required
  severity: ErrorSeverity
  errorType: ErrorType
  message: string

  // Recommended
  category?: string // For grouping (e.g., "payment-timeout", "order-creation-failed")
  action?: string // Human-readable action (e.g., "Processing payment for Order #1234")

  // Error object (we'll extract stack trace)
  error?: Error | unknown

  // Context
  locationId?: string
  employeeId?: string
  path?: string // URL or API route
  component?: string // React component name

  // Business Context (CRITICAL PATH)
  orderId?: string
  tableId?: string
  paymentId?: string
  customerId?: string

  // Technical Context
  requestBody?: any // Will be sanitized
  responseBody?: any
  queryParams?: Record<string, string>

  // Performance
  responseTime?: number // Milliseconds

  // Custom error code
  errorCode?: string // e.g., "PAY_001", "ORD_403"
}

interface BrowserInfo {
  userAgent: string
  platform: string
  language: string
  screenResolution: string
  viewport: string
}

// ============================================
// Helper Functions
// ============================================

/**
 * Extract stack trace from error object
 */
function extractStackTrace(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack
  }
  if (typeof error === 'object' && error !== null && 'stack' in error) {
    return String(error.stack)
  }
  return undefined
}

/**
 * Get browser information (client-side only)
 */
function getBrowserInfo(): BrowserInfo | undefined {
  if (typeof window === 'undefined') return undefined

  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    screenResolution: `${screen.width}x${screen.height}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
  }
}

/**
 * Sanitize sensitive data from request/response bodies
 */
function sanitizeData(data: any): string | undefined {
  if (!data) return undefined

  try {
    const sanitized = JSON.parse(JSON.stringify(data))

    // Remove sensitive fields
    const sensitiveKeys = [
      'password', 'pin', 'token', 'secret', 'apiKey', 'cardNumber',
      'cvv', 'ssn', 'bankAccount', 'routingNumber',
    ]

    function removeSensitive(obj: any) {
      if (typeof obj !== 'object' || obj === null) return

      for (const key in obj) {
        const lowerKey = key.toLowerCase()
        if (sensitiveKeys.some(s => lowerKey.includes(s))) {
          obj[key] = '[REDACTED]'
        } else if (typeof obj[key] === 'object') {
          removeSensitive(obj[key])
        }
      }
    }

    removeSensitive(sanitized)
    return JSON.stringify(sanitized)
  } catch {
    return '[Unable to sanitize data]'
  }
}

/**
 * Get current path (client or server)
 */
function getCurrentPath(): string {
  if (typeof window !== 'undefined') {
    return window.location.pathname + window.location.search
  }
  // Server-side: will be provided in context
  return 'unknown'
}

/**
 * Get location and employee from context (if available)
 */
function getContextIds(): { locationId?: string; employeeId?: string } {
  if (typeof window === 'undefined') return {}

  try {
    // Try to get from localStorage (set during login)
    const employeeId = localStorage.getItem('employeeId') || undefined
    const locationId = localStorage.getItem('locationId') || undefined
    return { employeeId, locationId }
  } catch {
    return {}
  }
}

// ============================================
// Error Capture Service
// ============================================

class ErrorCaptureService {
  /**
   * Log an error to the monitoring system
   */
  async log(data: ErrorCaptureData): Promise<void> {
    try {
      // Get context IDs if not provided
      const contextIds = getContextIds()
      const locationId = data.locationId || contextIds.locationId
      const employeeId = data.employeeId || contextIds.employeeId

      // Extract stack trace from error object
      const stackTrace = data.error ? extractStackTrace(data.error) : undefined

      // Get browser info (client-side)
      const browserInfo = getBrowserInfo()

      // Build error log payload
      const payload = {
        severity: data.severity,
        errorType: data.errorType,
        category: data.category || `${data.errorType.toLowerCase()}-error`,
        message: data.message,
        stackTrace,
        errorCode: data.errorCode,

        // Context
        locationId,
        employeeId,
        path: data.path || getCurrentPath(),
        action: data.action,
        component: data.component,

        // Business Context
        orderId: data.orderId,
        tableId: data.tableId,
        paymentId: data.paymentId,
        customerId: data.customerId,

        // Technical Context
        userAgent: browserInfo?.userAgent,
        browserInfo: browserInfo ? JSON.stringify(browserInfo) : undefined,
        requestBody: sanitizeData(data.requestBody),
        responseBody: sanitizeData(data.responseBody),
        queryParams: data.queryParams ? JSON.stringify(data.queryParams) : undefined,

        // Performance
        responseTime: data.responseTime,
      }

      // Send to monitoring API
      const response = await fetch('/api/monitoring/error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        // Failed to log error - log to console as fallback
        console.error('[Error Capture] Failed to log error to monitoring API:', {
          status: response.status,
          originalError: data,
        })
      }
    } catch (loggingError) {
      // Don't let error logging crash the app
      console.error('[Error Capture] Failed to log error:', loggingError)
    }
  }

  /**
   * Quick helpers for common severity levels
   */

  async critical(errorType: ErrorType, message: string, context?: Partial<ErrorCaptureData>) {
    return this.log({
      severity: 'CRITICAL',
      errorType,
      message,
      ...context,
    })
  }

  async high(errorType: ErrorType, message: string, context?: Partial<ErrorCaptureData>) {
    return this.log({
      severity: 'HIGH',
      errorType,
      message,
      ...context,
    })
  }

  async medium(errorType: ErrorType, message: string, context?: Partial<ErrorCaptureData>) {
    return this.log({
      severity: 'MEDIUM',
      errorType,
      message,
      ...context,
    })
  }

  async low(errorType: ErrorType, message: string, context?: Partial<ErrorCaptureData>) {
    return this.log({
      severity: 'LOW',
      errorType,
      message,
      ...context,
    })
  }
}

// Export singleton instance
export const errorCapture = new ErrorCaptureService()

// ============================================
// Severity Classification Helpers
// ============================================

/**
 * Determine severity based on error type and context
 */
export function classifySeverity(errorType: ErrorType, context: {
  isPayment?: boolean
  isOrder?: boolean
  affectsRevenue?: boolean
  userImpact?: 'blocking' | 'degraded' | 'minor' | 'none'
}): ErrorSeverity {
  // CRITICAL: Revenue-blocking issues
  if (errorType === 'PAYMENT' || errorType === 'ORDER') {
    return 'CRITICAL'
  }

  if (context.affectsRevenue || context.userImpact === 'blocking') {
    return 'CRITICAL'
  }

  // HIGH: Degraded functionality
  if (errorType === 'DATABASE' || context.userImpact === 'degraded') {
    return 'HIGH'
  }

  // MEDIUM: Minor issues
  if (context.userImpact === 'minor') {
    return 'MEDIUM'
  }

  // LOW: Everything else
  return 'LOW'
}

/**
 * Get suggested category based on error type and message
 */
export function suggestCategory(errorType: ErrorType, message: string): string {
  const lowerMessage = message.toLowerCase()

  if (errorType === 'PAYMENT') {
    if (lowerMessage.includes('timeout')) return 'payment-timeout'
    if (lowerMessage.includes('declined')) return 'payment-declined'
    if (lowerMessage.includes('network')) return 'payment-network-error'
    return 'payment-error'
  }

  if (errorType === 'ORDER') {
    if (lowerMessage.includes('timeout')) return 'order-timeout'
    if (lowerMessage.includes('validation')) return 'order-validation'
    if (lowerMessage.includes('not found')) return 'order-not-found'
    return 'order-error'
  }

  if (errorType === 'DATABASE') {
    if (lowerMessage.includes('timeout')) return 'db-timeout'
    if (lowerMessage.includes('connection')) return 'db-connection'
    if (lowerMessage.includes('constraint')) return 'db-constraint'
    return 'db-error'
  }

  return `${errorType.toLowerCase()}-error`
}
