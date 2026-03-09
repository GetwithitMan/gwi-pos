/**
 * HA Fence-Check API
 *
 * Used by promote.sh to verify whether the old primary is still alive.
 * If this returns 200 + role="primary", the promotion script ABORTS
 * to avoid split-brain.
 *
 * Also reports primary lease status from Mission Control arbiter,
 * enabling the backup to make informed promotion decisions.
 *
 * Access: internal network IPs only + x-ha-secret header.
 * NOT wrapped with withVenue() — this is infrastructure.
 *
 * GET /api/fence-check
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface FenceCheckResponse {
  role: 'primary' | 'standby'
  term: number
  pgInRecovery: boolean
  healthy: boolean
  /** ISO timestamp when the MC primary lease expires (null if no lease held) */
  primaryLeaseExpiry: string | null
  /** Whether this node currently holds a valid MC primary lease */
  holdsMcLease: boolean
}

/**
 * In-memory primary lease state.
 * Updated by ha-check.sh via the MC arbiter renew-lease endpoint.
 * The primary's health check loop renews the lease every 10 seconds.
 */
let mcLeaseExpiry: Date | null = null

/** Called by ha-check.sh lease renewal (via health route) to update local lease cache */
export function updateLocalLeaseExpiry(expiry: Date | null): void {
  mcLeaseExpiry = expiry
}

/** Read the current local lease expiry (used by health route) */
export function getLocalLeaseExpiry(): Date | null {
  return mcLeaseExpiry
}

/** RFC-1918 + loopback ranges */
function isInternalIp(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true
  // IPv4-mapped IPv6 (e.g. ::ffff:10.0.0.1)
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  const parts = v4.split('.').map(Number)
  if (parts.length !== 4 || parts.some(isNaN)) return false
  // 10.0.0.0/8
  if (parts[0] === 10) return true
  // 172.16.0.0/12
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true
  return false
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // HA must be configured
  const sharedSecret = process.env.HA_SHARED_SECRET
  if (!sharedSecret) {
    return NextResponse.json(
      { error: 'HA not configured' },
      { status: 503 }
    )
  }

  // Check caller IP — internal network only
  const forwardedFor = request.headers.get('x-forwarded-for')
  const callerIp = forwardedFor?.split(',')[0]?.trim() || '127.0.0.1'
  if (!isInternalIp(callerIp)) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403 }
    )
  }

  // Verify shared secret
  const headerSecret = request.headers.get('x-ha-secret')
  if (headerSecret !== sharedSecret) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  // Determine node health + PG recovery state
  let pgInRecovery = true
  let healthy = false

  try {
    const result = await db.$queryRaw<[{ pg_is_in_recovery: boolean }]>`SELECT pg_is_in_recovery()`
    pgInRecovery = result[0]?.pg_is_in_recovery ?? true
    healthy = true
  } catch (error) {
    console.error('[FenceCheck] DB query failed:', error)
    // pgInRecovery stays true, healthy stays false — safe default
  }

  // Check memory (same threshold as /api/health)
  const mem = process.memoryUsage()
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024)
  const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024)
  if (heapUsedMB >= heapTotalMB * 0.9) {
    healthy = false
  }

  const stationRole = process.env.STATION_ROLE || 'unknown'
  const isPrimary = stationRole === 'server' && !pgInRecovery && healthy

  // MC primary lease status
  const now = new Date()
  const holdsMcLease = mcLeaseExpiry !== null && mcLeaseExpiry > now
  const primaryLeaseExpiry = mcLeaseExpiry ? mcLeaseExpiry.toISOString() : null

  const response: FenceCheckResponse = {
    role: isPrimary ? 'primary' : 'standby',
    term: Date.now(),
    pgInRecovery,
    healthy,
    primaryLeaseExpiry,
    holdsMcLease,
  }

  return NextResponse.json(response, { status: 200 })
}
