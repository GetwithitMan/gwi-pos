/**
 * Internal HA Lease State API
 *
 * Called by ha-check.sh on the primary after renewing the MC arbiter lease.
 * Updates the in-memory lease expiry so that /api/fence-check and /api/health
 * can report accurate lease status.
 *
 * POST /api/internal/ha-lease
 * Body: { leaseExpiresAt: string (ISO 8601) | null }
 *
 * GET /api/internal/ha-lease
 * Returns current lease state.
 *
 * Auth: INTERNAL_API_SECRET or HA_SHARED_SECRET (bearer token)
 */

import { NextRequest, NextResponse } from 'next/server'
import { updateLocalLeaseExpiry, getLocalLeaseExpiry } from '@/lib/ha-lease-state'
import { err, ok, unauthorized } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

function authorize(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return false
  const token = authHeader.slice(7)

  // Accept either INTERNAL_API_SECRET or HA_SHARED_SECRET
  const internalSecret = process.env.INTERNAL_API_SECRET
  const haSecret = process.env.HA_SHARED_SECRET
  if (internalSecret && token === internalSecret) return true
  if (haSecret && token === haSecret) return true
  return false
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!authorize(request)) {
    return unauthorized('Unauthorized')
  }

  try {
    const body = await request.json()
    const { leaseExpiresAt } = body

    if (leaseExpiresAt === null || leaseExpiresAt === undefined) {
      updateLocalLeaseExpiry(null)
      return ok({ updated: true, leaseExpiresAt: null })
    }

    const expiry = new Date(leaseExpiresAt)
    if (isNaN(expiry.getTime())) {
      return err('Invalid leaseExpiresAt — must be ISO 8601')
    }

    updateLocalLeaseExpiry(expiry)
    return ok({ updated: true, leaseExpiresAt: expiry.toISOString() })
  } catch (caughtErr) {
    console.error('[ha-lease] POST error:', err)
    return err('Internal error', 500)
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorize(request)) {
    return unauthorized('Unauthorized')
  }

  const expiry = getLocalLeaseExpiry()
  const now = new Date()

  return ok({
    leaseExpiresAt: expiry ? expiry.toISOString() : null,
    holdsMcLease: expiry !== null && expiry > now,
    remainingSeconds: expiry ? Math.max(0, Math.round((expiry.getTime() - now.getTime()) / 1000)) : null,
  })
}
