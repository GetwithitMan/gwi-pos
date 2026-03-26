/**
 * POST /api/dashboard/terminals/[id]/pairing-code
 *
 * Regenerates the pairing code for an existing terminal.
 * Invalidates any previous code by overwriting it.
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import crypto from 'crypto'
import { withAuth } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

export const dynamic = 'force-dynamic'

const PAIRING_CODE_TTL_MS = 15 * 60 * 1000 // 15 minutes

// Rate limit: max 10 regenerations per terminal per hour
const regenAttempts = new Map<string, { count: number; resetAt: number }>()
const MAX_REGEN = 10
const REGEN_WINDOW_MS = 60 * 60 * 1000 // 1 hour

export const POST = withVenue(withAuth('ADMIN', async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: terminalId } = await context.params

    if (!terminalId) {
      return NextResponse.json({ error: 'Terminal ID is required' }, { status: 400 })
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

    // Rate limit per terminal
    const key = `${terminalId}:regen`
    const now = Date.now()
    const attempt = regenAttempts.get(key)
    if (attempt && attempt.resetAt > now && attempt.count >= MAX_REGEN) {
      return NextResponse.json(
        { error: 'Too many pairing code regenerations. Try again later.' },
        { status: 429 }
      )
    }

    // Look up terminal — must belong to this location
    const terminal = await db.terminal.findFirst({
      where: {
        id: terminalId,
        locationId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        isActive: true,
      },
    })

    if (!terminal) {
      return NextResponse.json({ error: 'Terminal not found' }, { status: 404 })
    }

    if (!terminal.isActive) {
      return NextResponse.json({ error: 'Cannot regenerate pairing code for inactive terminal' }, { status: 400 })
    }

    // Generate new pairing code
    const pairingCode = String(crypto.randomInt(100000, 999999))
    const pairingCodeExpiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS)

    // Update terminal with new code (overwrites previous)
    await db.terminal.update({
      where: { id: terminalId },
      data: {
        pairingCode,
        pairingCodeExpiresAt,
        lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
      },
    })

    // Track regeneration rate
    if (!attempt || attempt.resetAt <= now) {
      regenAttempts.set(key, { count: 1, resetAt: now + REGEN_WINDOW_MS })
    } else {
      attempt.count++
    }

    // Audit log (fire-and-forget)
    void db.auditLog.create({
      data: {
        locationId,
        action: 'terminal_pairing_code_regenerated',
        entityType: 'terminal',
        entityId: terminalId,
        details: {
          terminalName: terminal.name,
          source: 'dashboard',
        },
      },
    }).catch(console.error)

    void notifyDataChanged({ locationId, domain: 'hardware', action: 'updated', entityId: terminal.id })
    void pushUpstream()

    return NextResponse.json({
      pairingCode,
      pairingCodeExpiresAt: pairingCodeExpiresAt.toISOString(),
    })
  } catch (e) {
    console.error('[dashboard/terminals/[id]/pairing-code] POST error:', e)
    return NextResponse.json({ error: 'Failed to regenerate pairing code' }, { status: 500 })
  }
}))
