import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// NUC-only endpoint: BERG_ENABLED guard prevents this from running on Vercel.
//
// Venue safety: results are scoped to BERG_LOCATION_ID env var when set.
// On a single-tenant NUC this prevents a misconfigured multi-location setup
// from leaking cross-venue device configs.
const BERG_ENABLED = process.env.BERG_ENABLED === 'true'

export async function GET(request: NextRequest) {
  if (!BERG_ENABLED) {
    return NextResponse.json({ error: 'Berg not enabled' }, { status: 403 })
  }

  const bootstrapSecret = process.env.BRIDGE_BOOTSTRAP_SECRET
  if (!bootstrapSecret) {
    return NextResponse.json({ error: 'BRIDGE_BOOTSTRAP_SECRET not configured' }, { status: 503 })
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${bootstrapSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Scope to a specific location when BERG_LOCATION_ID is set.
  // On a NUC this should always be set — it binds the credential to a venue
  // and prevents any header-based location spoofing.
  const locationId = process.env.BERG_LOCATION_ID || undefined

  try {
    const devices = await db.bergDevice.findMany({
      where: {
        isActive: true,
        ...(locationId ? { locationId } : {}),
      },
      select: {
        id: true,
        locationId: true,
        name: true,
        portName: true,
        baudRate: true,
        ackTimeoutMs: true,
        pourReleaseMode: true,
        autoRingMode: true,
        bridgeSecretEncrypted: true,
        // Never return bridgeSecretHash
      },
    })

    return NextResponse.json({ devices, locationId: locationId ?? null })
  } catch (err) {
    console.error('[berg/bootstrap]', err)
    return NextResponse.json({ error: 'Failed to load devices' }, { status: 500 })
  }
}
