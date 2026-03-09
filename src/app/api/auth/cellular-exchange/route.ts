import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { issueCellularToken } from '@/lib/cellular-auth'
import { getDbForVenue } from '@/lib/db'

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
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { deviceId, nonce, deviceFingerprint } = parsed.data

    // Verify the nonce with Mission Control
    const mcUrl = process.env.MISSION_CONTROL_URL || 'https://app.thepasspos.com'
    const claimKey = process.env.CELLULAR_CLAIM_KEY || ''

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
      return NextResponse.json(
        { error: 'Failed to verify nonce with Mission Control' },
        { status: 502 }
      )
    }

    if (!mcResponse.ok) {
      const errorBody = await mcResponse.text().catch(() => 'unknown')
      console.error(`[cellular-exchange] MC returned ${mcResponse.status}: ${errorBody}`)
      return NextResponse.json(
        { error: `Nonce verification failed: ${mcResponse.status}` },
        { status: mcResponse.status }
      )
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
      return NextResponse.json(
        { error: 'Device fingerprint mismatch' },
        { status: 401 }
      )
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
      const venueDb = getDbForVenue(mcData.venueSlug)

      // Try MC's hint first (works when NUC and Neon IDs match)
      let location = await venueDb.location.findUnique({
        where: { id: mcData.locationId },
        select: { id: true },
      })

      // Hint didn't match — find the actual Location in this venue DB
      if (!location) {
        location = await venueDb.location.findFirst({
          select: { id: true },
        })
        if (location) {
          console.warn(
            `[cellular-exchange] MC locationId '${mcData.locationId}' not found in venue '${mcData.venueSlug}'. ` +
            `Resolved to '${location.id}' from venue DB. MC posLocationId is stale/wrong.`
          )
        }
      }

      if (!location) {
        console.error(`[cellular-exchange] No Location found in venue DB '${mcData.venueSlug}'. Venue not provisioned.`)
        return NextResponse.json(
          { error: `No location found in venue database '${mcData.venueSlug}'. Venue may not be provisioned.` },
          { status: 500 }
        )
      }

      resolvedLocationId = location.id
    } catch (dbError) {
      console.error(`[cellular-exchange] Failed to resolve locationId from venue DB '${mcData.venueSlug}':`, dbError)
      return NextResponse.json(
        { error: 'Failed to resolve location from venue database' },
        { status: 500 }
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
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    console.info(`[cellular-exchange] JWT issued: terminal=${mcData.terminalId} location=${resolvedLocationId} venue=${mcData.venueSlug}`)
    return NextResponse.json({ token })
  } catch (error) {
    console.error('[cellular-exchange] Unexpected error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
