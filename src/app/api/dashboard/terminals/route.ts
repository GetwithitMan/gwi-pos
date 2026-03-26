/**
 * POST /api/dashboard/terminals
 *
 * Creates a new terminal and generates a 6-digit pairing code.
 * Used by the NUC Dashboard app for device management.
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import crypto from 'crypto'
import { withAuth } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

export const dynamic = 'force-dynamic'

const VALID_CATEGORIES = ['FIXED_STATION', 'HANDHELD', 'CFD_DISPLAY'] as const
const VALID_PLATFORMS = ['ANDROID', 'BROWSER', 'IOS'] as const
const PAIRING_CODE_TTL_MS = 15 * 60 * 1000 // 15 minutes

export const POST = withVenue(withAuth('ADMIN', async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json()
    const { name, category, platform } = body

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    if (!category || !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        { error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` },
        { status: 400 }
      )
    }
    if (!platform || !VALID_PLATFORMS.includes(platform)) {
      return NextResponse.json(
        { error: `platform must be one of: ${VALID_PLATFORMS.join(', ')}` },
        { status: 400 }
      )
    }

    // Resolve locationId
    const { getRequestLocationId } = await import('@/lib/request-context')
    const locationId =
      getRequestLocationId() ||
      process.env.POS_LOCATION_ID ||
      process.env.LOCATION_ID

    if (!locationId) {
      return NextResponse.json({ error: 'No location context' }, { status: 400 })
    }

    // Generate 6-digit pairing code
    const pairingCode = String(crypto.randomInt(100000, 999999))
    const pairingCodeExpiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS)

    // Create terminal
    const terminal = await db.terminal.create({
      data: {
        locationId,
        name: name.trim(),
        category,
        platform,
        isActive: true,
        isPaired: false,
        pairingCode,
        pairingCodeExpiresAt,
        lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
      },
      select: {
        id: true,
        name: true,
        category: true,
        platform: true,
        pairingCode: true,
        pairingCodeExpiresAt: true,
      },
    })

    // Audit log (fire-and-forget)
    void db.auditLog.create({
      data: {
        locationId,
        action: 'terminal_created',
        entityType: 'terminal',
        entityId: terminal.id,
        details: {
          name: terminal.name,
          category: terminal.category,
          platform: terminal.platform,
          source: 'dashboard',
        },
      },
    }).catch(console.error)

    void notifyDataChanged({ locationId, domain: 'hardware', action: 'updated', entityId: terminal.id })
    void pushUpstream()

    return NextResponse.json({
      terminal: {
        id: terminal.id,
        name: terminal.name,
        category: terminal.category,
        platform: terminal.platform,
        pairingCode: terminal.pairingCode,
        pairingCodeExpiresAt: terminal.pairingCodeExpiresAt?.toISOString() ?? null,
      },
    })
  } catch (e) {
    console.error('[dashboard/terminals] POST error:', e)
    return NextResponse.json({ error: 'Failed to create terminal' }, { status: 500 })
  }
}))
