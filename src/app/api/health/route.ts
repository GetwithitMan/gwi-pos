/**
 * Health Check API
 *
 * Used by Docker healthcheck and monitoring systems to verify
 * the application is running and database is connected.
 *
 * GET /api/health
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface HealthResponse {
  status: 'healthy' | 'unhealthy' | 'degraded'
  timestamp: string
  version: string
  uptime: number
  database: 'connected' | 'disconnected' | 'error'
  checks: {
    database: boolean
    memory: boolean
  }
  error?: string
}

// Track server start time for uptime
const startTime = Date.now()

export async function GET(): Promise<NextResponse<HealthResponse>> {
  const timestamp = new Date().toISOString()
  const uptime = Math.floor((Date.now() - startTime) / 1000)
  const version = process.env.npm_package_version || '1.0.0'

  // Check database connection
  let databaseStatus: HealthResponse['database'] = 'disconnected'
  let databaseCheck = false

  try {
    // Simple query to verify database is accessible
    await db.$queryRaw`SELECT 1`
    databaseStatus = 'connected'
    databaseCheck = true
  } catch (error) {
    databaseStatus = 'error'
    console.error('[Health] Database check failed:', error)
  }

  // Check memory usage
  const memoryUsage = process.memoryUsage()
  const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024)
  const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024)
  const memoryCheck = heapUsedMB < heapTotalMB * 0.9 // Less than 90% heap used

  // Determine overall status
  let status: HealthResponse['status'] = 'healthy'

  if (!databaseCheck) {
    status = 'unhealthy'
  } else if (!memoryCheck) {
    status = 'degraded'
  }

  const response: HealthResponse = {
    status,
    timestamp,
    version,
    uptime,
    database: databaseStatus,
    checks: {
      database: databaseCheck,
      memory: memoryCheck,
    },
  }

  // Return appropriate HTTP status
  const httpStatus = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503

  return NextResponse.json(response, { status: httpStatus })
}
