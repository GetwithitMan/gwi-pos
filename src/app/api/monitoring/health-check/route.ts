/**
 * POST /api/monitoring/health-check
 *
 * Record health check results for critical systems.
 * Monitors order creation, payment processing, database queries, etc.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ============================================
// POST - Record Health Check
// ============================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Validate required fields
    if (!body.checkType || !body.status || !body.locationId) {
      return NextResponse.json(
        { error: 'Missing required fields: checkType, status, locationId' },
        { status: 400 }
      )
    }

    // Validate check type
    const validCheckTypes = [
      'ORDER_CREATION',
      'PAYMENT_PROCESSING',
      'PRINTER_CONNECTION',
      'DATABASE_QUERY',
      'API_RESPONSE',
      'KDS_CONNECTION',
      'NETWORK_CONNECTIVITY',
    ]
    if (!validCheckTypes.includes(body.checkType)) {
      return NextResponse.json(
        { error: `Invalid checkType. Must be one of: ${validCheckTypes.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate status
    const validStatuses = ['HEALTHY', 'DEGRADED', 'DOWN']
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      )
    }

    // Create health check record
    const healthCheck = await db.healthCheck.create({
      data: {
        locationId: body.locationId,
        checkType: body.checkType,
        status: body.status,
        responseTime: body.responseTime,
        errorMessage: body.errorMessage,
        details: body.details ? JSON.stringify(body.details) : undefined,
      },
    })

    // Alert on critical systems going DOWN
    if (body.status === 'DOWN') {
      const criticalSystems = ['ORDER_CREATION', 'PAYMENT_PROCESSING', 'DATABASE_QUERY']

      if (criticalSystems.includes(body.checkType)) {
        console.error('🚨 CRITICAL SYSTEM DOWN:', {
          id: healthCheck.id,
          checkType: body.checkType,
          errorMessage: body.errorMessage,
          locationId: body.locationId,
        })

        // TODO Phase 4: Send immediate alert
        // await sendCriticalSystemAlert(healthCheck)
      }
    }

    // Warn on degraded performance
    if (body.status === 'DEGRADED') {
      console.warn('⚠️ System degraded:', {
        id: healthCheck.id,
        checkType: body.checkType,
        responseTime: body.responseTime,
      })
    }

    return NextResponse.json({
      success: true,
      id: healthCheck.id,
      status: healthCheck.status,
    })

  } catch (error) {
    console.error('[Monitoring API] Failed to log health check:', error)

    return NextResponse.json(
      { error: 'Failed to log health check' },
      { status: 500 }
    )
  }
}

// ============================================
// GET - Get Latest Health Status
// ============================================

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId query parameter required' },
        { status: 400 }
      )
    }

    // Get latest health check for each check type
    const checkTypes = [
      'ORDER_CREATION',
      'PAYMENT_PROCESSING',
      'PRINTER_CONNECTION',
      'DATABASE_QUERY',
      'API_RESPONSE',
      'KDS_CONNECTION',
      'NETWORK_CONNECTIVITY',
    ]

    const healthStatus = await Promise.all(
      checkTypes.map(async (checkType) => {
        const latestCheck = await db.healthCheck.findFirst({
          where: {
            locationId,
            checkType,
          },
          orderBy: { createdAt: 'desc' },
        })

        return {
          checkType,
          status: latestCheck?.status || 'UNKNOWN',
          responseTime: latestCheck?.responseTime,
          lastChecked: latestCheck?.createdAt,
          errorMessage: latestCheck?.errorMessage,
        }
      })
    )

    // Overall system health
    const hasDown = healthStatus.some(s => s.status === 'DOWN')
    const hasDegraded = healthStatus.some(s => s.status === 'DEGRADED')

    const overallStatus = hasDown ? 'DOWN' : hasDegraded ? 'DEGRADED' : 'HEALTHY'

    return NextResponse.json({
      success: true,
      overallStatus,
      checks: healthStatus,
      timestamp: new Date(),
    })

  } catch (error) {
    console.error('[Monitoring API] Failed to get health status:', error)

    return NextResponse.json(
      { error: 'Failed to get health status' },
      { status: 500 }
    )
  }
}

// ============================================
// Helper: Health Check Utility
// ============================================

/**
 * Utility function for running health checks
 *
 * Usage:
 * ```typescript
 * import { runHealthCheck } from '@/app/api/monitoring/health-check/route'
 *
 * // Periodic health check
 * setInterval(async () => {
 *   await runHealthCheck(
 *     'ORDER_CREATION',
 *     locationId,
 *     async () => {
 *       const result = await fetch('/api/orders?test=true')
 *       return result.ok
 *     }
 *   )
 * }, 60000) // Every minute
 * ```
 */
export async function runHealthCheck(
  checkType: string,
  locationId: string,
  healthCheckFn: () => Promise<boolean>,
  details?: any
): Promise<void> {
  const startTime = Date.now()

  try {
    const isHealthy = await healthCheckFn()
    const responseTime = Date.now() - startTime

    // Log health check result
    await fetch('/api/monitoring/health-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        checkType,
        locationId,
        status: isHealthy ? 'HEALTHY' : 'DEGRADED',
        responseTime,
        details,
      }),
    })
  } catch (error) {
    const responseTime = Date.now() - startTime

    // Log failure
    await fetch('/api/monitoring/health-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        checkType,
        locationId,
        status: 'DOWN',
        responseTime,
        errorMessage: error instanceof Error ? error.message : String(error),
        details,
      }),
    })
  }
}
