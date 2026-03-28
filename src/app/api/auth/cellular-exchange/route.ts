import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { issueCellularToken } from '@/lib/cellular-auth'
import { getDbForVenue } from '@/lib/db'
import { err, ok, unauthorized } from '@/lib/api-response'

const bodySchema = z.object({
  deviceId: z.string().min(1),
  nonce: z.string().min(1),
  deviceFingerprint: z.string().min(1),
})

/**
 * POST /api/auth/cellular-exchange
 *
 * Exchanges a pairing nonce for a cellular JWT.
 * Called by PAX devices after pairing via Mission Control.
 *
 * No auth required — the nonce IS the auth credential.
 * The nonce is verified against Mission Control, which returns
 * the terminalId/locationId/venueSlug bound to that pairing.
 */
export async function POST(request: NextRequest) {
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return err('Invalid JSON body')
    }

    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return err('Validation failed', 400, parsed.error.flatten().fieldErrors)
    }

    const { deviceId, nonce, deviceFingerprint } = parsed.data

    // Verify the nonce with Mission Control
    const mcUrl = process.env.MISSION_CONTROL_URL || 'https://app.thepasspos.com'
    const claimKey = process.env.CELLULAR_CLAIM_KEY
    if (!claimKey) {
      console.error('[cellular-exchange] CELLULAR_CLAIM_KEY not configured')
      return err('Server not configured for cellular pairing', 503)
    }

    let mcResponse: Response
    try {
      mcResponse = await fetch(`${mcUrl}/api/fleet/cellular/verify-nonce`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cellular-claim-key': claimKey,
        },
        body: JSON.stringify({ deviceId, nonce }),
        signal: AbortSignal.timeout(10_000),
      })
    } catch (error) {
      console.error('[cellular-exchange] MC fetch failed:', error)
      return err('Failed to verify nonce with Mission Control', 502)
    }

    if (!mcResponse.ok) {
      const errorBody = await mcResponse.text().catch(() => 'unknown')
      console.error(`[cellular-exchange] MC returned ${mcResponse.status}: ${errorBody}`)
      return err(`Nonce verification failed: ${mcResponse.status}`, mcResponse.status)
    }

    const mcResult = (await mcResponse.json()) as {
      data: {
        valid: boolean
        terminalId: string
        locationId: string
        venueSlug: string
        deviceFingerprint: string
      }
    }

    const mcData = mcResult.data

    // Verify device fingerprint matches what MC has on record
    if (deviceFingerprint !== mcData.deviceFingerprint) {
      console.error(JSON.stringify({
        event: 'cellular_exchange_fingerprint_mismatch',
        deviceId,
        expected: mcData.deviceFingerprint,
        received: deviceFingerprint,
        timestamp: new Date().toISOString(),
      }))
      return unauthorized('Device fingerprint mismatch')
    }

    // -----------------------------------------------------------------------
    // Resolve the REAL Location.id from the venue's Neon DB.
    //
    // MC's posLocationId comes from the NUC heartbeat and reflects the
    // NUC's local PG Location.id. Cellular goes through Neon, which may
    // have a DIFFERENT Location.id (e.g. CUID vs human-readable).
    // Always trust the venue DB as the source of truth.
    // -----------------------------------------------------------------------
    let resolvedLocationId: string
    try {
      const venueDb = await getDbForVenue(mcData.venueSlug)

      // Try MC's hint first (works when NUC and Neon IDs match)
      let location = await venueDb.location.findUnique({
        where: { id: mcData.locationId },
        select: { id: true },
      })

      // Hint didn't match — find the actual Location in this venue DB.
      // Filter to non-deleted locations and use oldest (likely primary) to avoid
      // returning an arbitrary row in multi-location venue databases.
      if (!location) {
        location = await venueDb.location.findFirst({
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        })
        if (location) {
          console.warn(
            `[cellular-exchange] MC locationId '${mcData.locationId}' not found in venue '${mcData.venueSlug}'. ` +
            `Falling back to '${location.id}' (oldest non-deleted). MC posLocationId is stale/wrong.`
          )
        }
      }

      if (!location) {
        console.error(`[cellular-exchange] No Location found in venue DB '${mcData.venueSlug}'. Venue not provisioned.`)
        return err(`No location found in venue database '${mcData.venueSlug}'. Venue may not be provisioned.`, 500)
      }

      resolvedLocationId = location.id
    } catch (dbError) {
      console.error(`[cellular-exchange] Failed to resolve locationId from venue DB '${mcData.venueSlug}':`, dbError)
      return err('Failed to resolve location from venue database', 500)
    }

    // Cellular device count limit check (subscription-gated)
    // Pass the venue-specific DB since this route is NOT wrapped in withVenue
    const venueDbForLimits = await getDbForVenue(mcData.venueSlug)
    const { checkDeviceLimit } = await import('@/lib/device-limits')
    const cellularLimit = await checkDeviceLimit(resolvedLocationId, 'cellular', venueDbForLimits)
    if (!cellularLimit.allowed) {
      return NextResponse.json(
        {
          error: cellularLimit.upgradeMessage,
          code: 'DEVICE_LIMIT_EXCEEDED',
          current: cellularLimit.current,
          limit: cellularLimit.limit,
        },
        { status: 403 }
      )
    }

    // Issue a cellular JWT with the Neon-resolved locationId
    let token: string
    try {
      token = await issueCellularToken(
        mcData.terminalId,
        resolvedLocationId,
        mcData.venueSlug,
        deviceFingerprint,
        'CELLULAR_ROAMING'
      )
    } catch (issueError) {
      console.error('[cellular-exchange] Token issuance failed:', issueError)
      const msg = issueError instanceof Error ? issueError.message : 'Token issuance failed'
      return err(msg, 500)
    }

    console.info(`[cellular-exchange] JWT issued: terminal=${mcData.terminalId} location=${resolvedLocationId} venue=${mcData.venueSlug}`)
    return ok({ token })
  } catch (error) {
    console.error('[cellular-exchange] Unexpected error:', error)
    return err(error instanceof Error ? error.message : 'Internal server error', 500)
  }
}
