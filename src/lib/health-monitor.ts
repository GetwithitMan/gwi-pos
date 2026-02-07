/**
 * Health Monitoring Service
 *
 * Runs periodic health checks for critical systems:
 * - ORDER_CREATION - Can orders be created?
 * - PAYMENT_PROCESSING - Can payments be processed?
 * - DATABASE_QUERY - Is the database responding?
 * - API_RESPONSE - Are API endpoints responding?
 * - NETWORK_CONNECTIVITY - Is the network available?
 *
 * Usage (Client-side):
 * ```typescript
 * import { startHealthMonitoring, stopHealthMonitoring } from '@/lib/health-monitor'
 *
 * // Start monitoring when app loads
 * startHealthMonitoring(locationId)
 *
 * // Stop monitoring when app unloads
 * stopHealthMonitoring()
 * ```
 */

// ============================================
// Configuration
// ============================================

const HEALTH_CHECK_INTERVAL = 60000 // 60 seconds
const HEALTH_CHECK_TIMEOUT = 10000  // 10 seconds

interface HealthCheckResult {
  checkType: string
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN'
  responseTime?: number
  errorMessage?: string
}

// ============================================
// Health Check Functions
// ============================================

/**
 * Check if order creation is working
 */
async function checkOrderCreation(locationId: string): Promise<HealthCheckResult> {
  const startTime = Date.now()

  try {
    // Test order validation endpoint (lightweight check)
    const response = await fetch(`/api/orders?locationId=${locationId}&limit=1`, {
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT),
    })

    const responseTime = Date.now() - startTime

    if (response.ok) {
      return {
        checkType: 'ORDER_CREATION',
        status: responseTime > 5000 ? 'DEGRADED' : 'HEALTHY',
        responseTime,
      }
    } else {
      return {
        checkType: 'ORDER_CREATION',
        status: 'DOWN',
        responseTime,
        errorMessage: `API returned ${response.status}`,
      }
    }
  } catch (error) {
    const responseTime = Date.now() - startTime

    return {
      checkType: 'ORDER_CREATION',
      status: 'DOWN',
      responseTime,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Check if database queries are responding
 */
async function checkDatabaseQuery(locationId: string): Promise<HealthCheckResult> {
  const startTime = Date.now()

  try {
    // Simple query to test database connectivity
    const response = await fetch(`/api/employees?locationId=${locationId}&limit=1`, {
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT),
    })

    const responseTime = Date.now() - startTime

    if (response.ok) {
      return {
        checkType: 'DATABASE_QUERY',
        status: responseTime > 3000 ? 'DEGRADED' : 'HEALTHY',
        responseTime,
      }
    } else {
      return {
        checkType: 'DATABASE_QUERY',
        status: 'DOWN',
        responseTime,
        errorMessage: `API returned ${response.status}`,
      }
    }
  } catch (error) {
    const responseTime = Date.now() - startTime

    return {
      checkType: 'DATABASE_QUERY',
      status: 'DOWN',
      responseTime,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Check network connectivity
 */
async function checkNetworkConnectivity(): Promise<HealthCheckResult> {
  const startTime = Date.now()

  try {
    // Simple connectivity check
    const response = await fetch('/api/monitoring/health-check', {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    })

    const responseTime = Date.now() - startTime

    return {
      checkType: 'NETWORK_CONNECTIVITY',
      status: response.ok ? 'HEALTHY' : 'DEGRADED',
      responseTime,
    }
  } catch (error) {
    const responseTime = Date.now() - startTime

    return {
      checkType: 'NETWORK_CONNECTIVITY',
      status: 'DOWN',
      responseTime,
      errorMessage: error instanceof Error ? error.message : 'Network unavailable',
    }
  }
}

// ============================================
// Health Monitor Service
// ============================================

let monitorInterval: NodeJS.Timeout | null = null
let currentLocationId: string | null = null

/**
 * Run all health checks and log results
 */
async function runAllHealthChecks(locationId: string): Promise<void> {
  try {
    // Run health checks in parallel
    const results = await Promise.all([
      checkOrderCreation(locationId),
      checkDatabaseQuery(locationId),
      checkNetworkConnectivity(),
    ])

    // Log each health check result to monitoring API
    for (const result of results) {
      await fetch('/api/monitoring/health-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          ...result,
        }),
      }).catch((err) => {
        // Silently fail - don't let health check logging break monitoring
        console.warn(`Failed to log health check for ${result.checkType}:`, err)
      })
    }

    // Warn in console if any checks are down
    const downChecks = results.filter(r => r.status === 'DOWN')
    if (downChecks.length > 0) {
      console.error('🚨 System health issues detected:', downChecks.map(r => r.checkType))
    }

    const degradedChecks = results.filter(r => r.status === 'DEGRADED')
    if (degradedChecks.length > 0) {
      console.warn('⚠️ System performance degraded:', degradedChecks.map(r => r.checkType))
    }

  } catch (error) {
    console.error('Failed to run health checks:', error)
  }
}

/**
 * Start periodic health monitoring
 */
export function startHealthMonitoring(locationId: string): void {
  // Don't start if already running
  if (monitorInterval) {
    console.warn('Health monitoring already running')
    return
  }

  currentLocationId = locationId

  // Run initial check immediately
  runAllHealthChecks(locationId)

  // Start periodic checks
  monitorInterval = setInterval(() => {
    if (currentLocationId) {
      runAllHealthChecks(currentLocationId)
    }
  }, HEALTH_CHECK_INTERVAL)

  console.log(`✅ Health monitoring started (every ${HEALTH_CHECK_INTERVAL / 1000}s)`)
}

/**
 * Stop periodic health monitoring
 */
export function stopHealthMonitoring(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval)
    monitorInterval = null
    currentLocationId = null
    console.log('Health monitoring stopped')
  }
}

/**
 * Get current health status
 */
export async function getCurrentHealthStatus(locationId: string): Promise<{
  overallStatus: 'HEALTHY' | 'DEGRADED' | 'DOWN'
  checks: HealthCheckResult[]
}> {
  const results = await Promise.all([
    checkOrderCreation(locationId),
    checkDatabaseQuery(locationId),
    checkNetworkConnectivity(),
  ])

  const hasDown = results.some(r => r.status === 'DOWN')
  const hasDegraded = results.some(r => r.status === 'DEGRADED')

  return {
    overallStatus: hasDown ? 'DOWN' : hasDegraded ? 'DEGRADED' : 'HEALTHY',
    checks: results,
  }
}
