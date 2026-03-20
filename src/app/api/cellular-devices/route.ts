import { NextRequest, NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import {
  getAllCellularSessions,
  isRevoked,
  revokeTerminal,
} from '@/lib/cellular-auth'
import { db } from '@/lib/db'
import { emitToLocation } from '@/lib/socket-server'

/**
 * GET /api/cellular-devices?locationId=xxx
 *
 * List all known cellular sessions for this location.
 * Combines in-memory active session registry with deny list status.
 * Also queries the CellularDevice table (if it exists) for DB-persisted revocations.
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(
      actor.employeeId,
      locationId,
      PERMISSIONS.SETTINGS_HARDWARE
    )
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Get in-memory sessions (includes expired within 24h window)
    const sessions = getAllCellularSessions(locationId)

    // Also check DB for any devices with revoked/quarantined status
    let dbRevokedTerminals: string[] = []
    try {
      const revoked = await db.$queryRawUnsafe<Array<{ terminalId: string }>>(
        `SELECT "terminalId" FROM "CellularDevice" WHERE "locationId" = $1 AND status IN ('REVOKED', 'QUARANTINED') AND "terminalId" IS NOT NULL`,
        locationId
      )
      dbRevokedTerminals = revoked.map(r => r.terminalId)
    } catch {
      // CellularDevice table may not exist — safe to skip
    }

    const revokedSet = new Set(dbRevokedTerminals)

    const devices = sessions.map(session => ({
      terminalId: session.terminalId,
      deviceFingerprint: session.deviceFingerprint,
      venueSlug: session.venueSlug,
      lastActiveAt: session.lastRequestAt.toISOString(),
      issuedAt: session.issuedAt.toISOString(),
      tokenExpiresAt: session.expiresAt.toISOString(),
      isExpired: session.isExpired,
      isRevoked: isRevoked(session.terminalId) || revokedSet.has(session.terminalId),
      status: isRevoked(session.terminalId) || revokedSet.has(session.terminalId)
        ? 'revoked'
        : session.isExpired
          ? 'expired'
          : 'active',
    }))

    // Sort: active first, then expired, then revoked
    const statusOrder = { active: 0, expired: 1, revoked: 2 }
    devices.sort((a, b) => {
      const orderDiff = statusOrder[a.status as keyof typeof statusOrder] - statusOrder[b.status as keyof typeof statusOrder]
      if (orderDiff !== 0) return orderDiff
      // Within same status, most recently active first
      return new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
    })

    return NextResponse.json({ data: { devices } })
  } catch (error) {
    console.error('[cellular-devices] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

/**
 * POST /api/cellular-devices
 *
 * Revoke a cellular device's access.
 * Body: { locationId, terminalId, deviceFingerprint, reason? }
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, terminalId, deviceFingerprint, reason } = body as {
      locationId?: string
      terminalId?: string
      deviceFingerprint?: string
      reason?: string
    }

    if (!locationId || !terminalId) {
      return NextResponse.json(
        { error: 'locationId and terminalId are required' },
        { status: 400 }
      )
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(
      actor.employeeId,
      locationId,
      PERMISSIONS.SETTINGS_HARDWARE
    )
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Already revoked check
    if (isRevoked(terminalId)) {
      return NextResponse.json(
        { error: 'Device is already revoked' },
        { status: 409 }
      )
    }

    // Add to in-memory deny list + persist to DB (revokeTerminal handles both)
    await revokeTerminal(terminalId, locationId)

    // Audit log
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'cellular_device_revoked',
        entityType: 'cellular_device',
        entityId: terminalId,
        details: {
          terminalId,
          deviceFingerprint: deviceFingerprint || 'unknown',
          reason: reason || 'Manual revocation from POS admin',
          revokedBy: `${auth.employee.firstName} ${auth.employee.lastName}`,
        },
      },
    }).catch(console.error)

    // Emit socket event so the device gets kicked in real-time
    void emitToLocation(locationId, 'cellular:device-revoked', {
      terminalId,
      deviceFingerprint: deviceFingerprint || undefined,
      reason: reason || 'Access revoked by venue administrator',
    }).catch(console.error)

    return NextResponse.json({
      data: { success: true, terminalId, revokedAt: new Date().toISOString() },
    })
  } catch (error) {
    console.error('[cellular-devices] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
