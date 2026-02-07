/**
 * Monitored Fetch Wrapper
 *
 * Automatically captures API errors, logs performance issues,
 * and tracks failed requests.
 *
 * Usage:
 * ```typescript
 * import { monitoredFetch } from '@/lib/monitored-fetch'
 *
 * // Replace all fetch() calls with monitoredFetch()
 * const response = await monitoredFetch('/api/orders', {
 *   method: 'POST',
 *   body: JSON.stringify(orderData),
 * })
 * ```
 *
 * Or use the helper methods:
 * ```typescript
 * import { api } from '@/lib/monitored-fetch'
 *
 * const data = await api.post('/api/orders', orderData)
 * const orders = await api.get('/api/orders?locationId=123')
 * ```
 */

import { errorCapture } from './error-capture'

// ============================================
// Configuration
// ============================================

const PERFORMANCE_THRESHOLDS = {
  GET: 2000,      // 2 seconds
  POST: 3000,     // 3 seconds
  PUT: 3000,      // 3 seconds
  DELETE: 2000,   // 2 seconds
  PATCH: 3000,    // 3 seconds
}

// ============================================
// Monitored Fetch Wrapper
// ============================================

export interface MonitoredFetchOptions extends RequestInit {
  skipErrorCapture?: boolean // Set to true to disable automatic error logging
  skipPerformanceLog?: boolean // Set to true to disable performance monitoring
  performanceThreshold?: number // Custom threshold in ms (overrides defaults)
}

/**
 * Fetch wrapper with automatic error capture and performance monitoring
 */
export async function monitoredFetch(
  url: string,
  options: MonitoredFetchOptions = {}
): Promise<Response> {
  const startTime = Date.now()
  const method = (options.method || 'GET').toUpperCase()

  // Extract monitoring options
  const {
    skipErrorCapture = false,
    skipPerformanceLog = false,
    performanceThreshold,
    ...fetchOptions
  } = options

  try {
    // Make the actual fetch call
    const response = await fetch(url, fetchOptions)

    // Calculate response time
    const duration = Date.now() - startTime

    // Log performance if exceeded threshold
    if (!skipPerformanceLog) {
      const threshold = performanceThreshold || PERFORMANCE_THRESHOLDS[method as keyof typeof PERFORMANCE_THRESHOLDS] || 2000

      if (duration > threshold) {
        // Fire-and-forget performance logging
        logPerformance(url, method, duration, threshold).catch(() => {
          // Silently fail - don't block the response
        })
      }
    }

    // Log API errors (4xx, 5xx responses)
    if (!response.ok && !skipErrorCapture) {
      // Try to get error message from response
      let errorMessage = `API ${method} ${url} failed with status ${response.status}`
      let responseBody: any

      try {
        const contentType = response.headers.get('content-type')
        if (contentType?.includes('application/json')) {
          responseBody = await response.clone().json()
          errorMessage = responseBody.error || responseBody.message || errorMessage
        }
      } catch {
        // Failed to parse response body - use default message
      }

      // Classify severity based on status code
      const severity = classifyHttpErrorSeverity(response.status, url)

      // Fire-and-forget error logging
      errorCapture.log({
        severity,
        errorType: 'API',
        category: `api-${response.status}`,
        message: errorMessage,
        path: url,
        action: `${method} ${url}`,
        requestBody: options.body ? sanitizeRequestBody(options.body) : undefined,
        responseBody: responseBody ? JSON.stringify(responseBody) : undefined,
        responseTime: duration,
        errorCode: `HTTP_${response.status}`,
      }).catch(() => {
        // Silently fail - don't block the response
      })
    }

    return response

  } catch (error) {
    // Network error, timeout, or other fetch failure
    const duration = Date.now() - startTime

    if (!skipErrorCapture) {
      // Determine if this is a critical path
      const isCriticalPath = url.includes('/orders') || url.includes('/payment')

      errorCapture.log({
        severity: isCriticalPath ? 'CRITICAL' : 'HIGH',
        errorType: 'NETWORK',
        category: 'network-error',
        message: error instanceof Error ? error.message : 'Network request failed',
        path: url,
        action: `${method} ${url}`,
        error,
        requestBody: options.body ? sanitizeRequestBody(options.body) : undefined,
        responseTime: duration,
      }).catch(() => {
        // Silently fail - don't block the error throw
      })
    }

    // Re-throw the error so calling code can handle it
    throw error
  }
}

// ============================================
// Helper Functions
// ============================================

/**
 * Classify HTTP error severity based on status code
 */
function classifyHttpErrorSeverity(status: number, url: string): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' {
  // Critical paths (orders, payments)
  const isCriticalPath = url.includes('/orders') || url.includes('/payment')

  // 5xx errors
  if (status >= 500) {
    return isCriticalPath ? 'CRITICAL' : 'HIGH'
  }

  // 4xx errors
  if (status >= 400) {
    // 401, 403 - authentication/authorization (medium unless critical path)
    if (status === 401 || status === 403) {
      return isCriticalPath ? 'HIGH' : 'MEDIUM'
    }

    // 404 - not found (low unless critical path)
    if (status === 404) {
      return isCriticalPath ? 'MEDIUM' : 'LOW'
    }

    // 400, 422 - validation errors (medium)
    if (status === 400 || status === 422) {
      return 'MEDIUM'
    }

    // Other 4xx
    return 'MEDIUM'
  }

  return 'LOW'
}

/**
 * Sanitize request body for logging
 */
function sanitizeRequestBody(body: BodyInit): string {
  try {
    if (typeof body === 'string') {
      const parsed = JSON.parse(body)
      return sanitizeObject(parsed)
    }
    return '[Unable to parse request body]'
  } catch {
    return '[Unable to parse request body]'
  }
}

function sanitizeObject(obj: any): string {
  const sanitized = JSON.parse(JSON.stringify(obj))

  const sensitiveKeys = [
    'password', 'pin', 'token', 'secret', 'apiKey',
    'cardNumber', 'cvv', 'ssn', 'bankAccount',
  ]

  function removeSensitive(o: any) {
    if (typeof o !== 'object' || o === null) return

    for (const key in o) {
      const lowerKey = key.toLowerCase()
      if (sensitiveKeys.some(s => lowerKey.includes(s))) {
        o[key] = '[REDACTED]'
      } else if (typeof o[key] === 'object') {
        removeSensitive(o[key])
      }
    }
  }

  removeSensitive(sanitized)
  return JSON.stringify(sanitized)
}

/**
 * Log performance issue
 */
async function logPerformance(
  url: string,
  method: string,
  duration: number,
  threshold: number
): Promise<void> {
  // Get locationId from localStorage if available
  let locationId: string | undefined
  try {
    locationId = localStorage.getItem('locationId') || undefined
  } catch {
    // Server-side or localStorage not available
  }

  if (!locationId) return // Can't log without locationId

  await fetch('/api/monitoring/performance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      locationId,
      operation: `API: ${method} ${url}`,
      duration,
      threshold,
      path: url,
    }),
  })
}

// ============================================
// Convenient API Helpers
// ============================================

/**
 * Convenient API helper methods
 */
export const api = {
  /**
   * GET request with automatic JSON parsing
   */
  async get<T = any>(url: string, options?: MonitoredFetchOptions): Promise<T> {
    const response = await monitoredFetch(url, {
      ...options,
      method: 'GET',
    })

    if (!response.ok) {
      throw new Error(`GET ${url} failed with status ${response.status}`)
    }

    return response.json()
  },

  /**
   * POST request with automatic JSON serialization and parsing
   */
  async post<T = any>(url: string, data?: any, options?: MonitoredFetchOptions): Promise<T> {
    const response = await monitoredFetch(url, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    })

    if (!response.ok) {
      throw new Error(`POST ${url} failed with status ${response.status}`)
    }

    return response.json()
  },

  /**
   * PUT request with automatic JSON serialization and parsing
   */
  async put<T = any>(url: string, data?: any, options?: MonitoredFetchOptions): Promise<T> {
    const response = await monitoredFetch(url, {
      ...options,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    })

    if (!response.ok) {
      throw new Error(`PUT ${url} failed with status ${response.status}`)
    }

    return response.json()
  },

  /**
   * DELETE request
   */
  async delete<T = any>(url: string, options?: MonitoredFetchOptions): Promise<T> {
    const response = await monitoredFetch(url, {
      ...options,
      method: 'DELETE',
    })

    if (!response.ok) {
      throw new Error(`DELETE ${url} failed with status ${response.status}`)
    }

    return response.json()
  },

  /**
   * PATCH request with automatic JSON serialization and parsing
   */
  async patch<T = any>(url: string, data?: any, options?: MonitoredFetchOptions): Promise<T> {
    const response = await monitoredFetch(url, {
      ...options,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    })

    if (!response.ok) {
      throw new Error(`PATCH ${url} failed with status ${response.status}`)
    }

    return response.json()
  },
}
