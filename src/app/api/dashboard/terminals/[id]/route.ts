/**
 * PATCH /api/dashboard/terminals/[id]
 *
 * Deactivates a terminal. Only allows setting isActive to false
 * (deactivation only — no reactivation from the dashboard).
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

export const dynamic = 'force-dynamic'

export const PATCH = withVenue(async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: terminalId } = await context.params

    if (!terminalId) {
      return NextResponse.json({ error: 'Terminal ID is required' }, { status: 400 })
    }

    const body = await request.json()
    const { isActive } = body

    // Only allow deactivation (isActive: false)
    if (isActive !== false) {
      return NextResponse.json(
        { error: 'Only deactivation (isActive: false) is allowed from the dashboard' },
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
      // Already deactivated — idempotent response
      return NextResponse.json({
        terminal: {
          id: terminal.id,
          name: terminal.name,
          isActive: false,
        },
      })
    }

    // Deactivate
    const updated = await db.terminal.update({
      where: { id: terminalId },
      data: {
        isActive: false,
        isPaired: false,
        pairingCode: null,
        pairingCodeExpiresAt: null,
        deviceToken: null,
        lastMutatedBy: 'local',
      },
      select: {
        id: true,
        name: true,
        isActive: true,
      },
    })

    // Audit log (fire-and-forget)
    void db.auditLog.create({
      data: {
        locationId,
        action: 'terminal_deactivated',
        entityType: 'terminal',
        entityId: terminalId,
        details: {
          terminalName: terminal.name,
          source: 'dashboard',
        },
      },
    }).catch(console.error)

    return NextResponse.json({
      terminal: {
        id: updated.id,
        name: updated.name,
        isActive: updated.isActive,
      },
    })
  } catch (e) {
    console.error('[dashboard/terminals/[id]] PATCH error:', e)
    return NextResponse.json({ error: 'Failed to deactivate terminal' }, { status: 500 })
  }
})
