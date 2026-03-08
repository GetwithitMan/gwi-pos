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
import { withVenue } from '@/lib/with-venue'

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
  pgRole: 'primary' | 'standby' | 'unknown'
  stationRole: string
  virtualIp: string | null
  replicationLag: number | null
  isVipOwner: boolean | null
  error?: string
}

// Track server start time for uptime
const startTime = Date.now()

export const GET = withVenue(async function GET(): Promise<NextResponse<{ data: HealthResponse }>> {
  const timestamp = new Date().toISOString()
  const uptime = Math.floor((Date.now() - startTime) / 1000)
  const version = process.env.npm_package_version || '1.0.0'

  // Check database connection + PG recovery state
  let databaseStatus: HealthResponse['database'] = 'disconnected'
  let databaseCheck = false
  let pgRole: HealthResponse['pgRole'] = 'unknown'
  let replicationLag: number | null = null

  try {
    // Verify database is accessible and check recovery state
    const [recoveryResult] = await db.$queryRaw<[{ pg_is_in_recovery: boolean }]>`SELECT pg_is_in_recovery()`
    databaseStatus = 'connected'
    databaseCheck = true
    pgRole = recoveryResult.pg_is_in_recovery ? 'standby' : 'primary'

    // On standby, measure replication lag
    if (pgRole === 'standby') {
      try {
        const [lagResult] = await db.$queryRaw<[{ lag: number | null }]>`SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) as lag`
        replicationLag = lagResult.lag != null ? Math.round(lagResult.lag * 100) / 100 : null
      } catch {
        // Non-critical — lag unavailable
      }
    }
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

  const stationRole = process.env.STATION_ROLE || 'unknown'
  const virtualIp = process.env.VIRTUAL_IP || null

  const response: HealthResponse = {
    status,
    timestamp,
    // Omit version and uptime in production to avoid leaking server info
    version: process.env.NODE_ENV === 'production' ? 'ok' : version,
    uptime: process.env.NODE_ENV === 'production' ? 0 : uptime,
    database: databaseStatus,
    checks: {
      database: databaseCheck,
      memory: memoryCheck,
    },
    pgRole,
    stationRole,
    virtualIp,
    replicationLag,
    isVipOwner: virtualIp ? stationRole === 'server' : null,
  }

  // Return appropriate HTTP status
  const httpStatus = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503

  return NextResponse.json({ data: response }, { status: httpStatus })
})
