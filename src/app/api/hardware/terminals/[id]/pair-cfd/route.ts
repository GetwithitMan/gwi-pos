import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'
import { clearCfdMapping, setCfdMapping } from '@/lib/socket-server'
import { dispatchCFDIdle } from '@/lib/socket-dispatch/cfd-dispatch'

// POST — Link a CFD terminal to a register terminal (1:1 enforced)
export const POST = withVenue(withAuth('ADMIN', async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const { cfdTerminalId, cfdIpAddress, cfdConnectionMode, cfdSerialNumber } = body

    if (!cfdTerminalId) {
      return err('cfdTerminalId is required')
    }

    if (cfdTerminalId === id) {
      return err('A terminal cannot be paired to itself')
    }

    const existing = await db.terminal.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return notFound('Terminal not found')
    }

    const previousCfdTerminalId = existing.cfdTerminalId ?? null

    if ((existing as any).category === 'CFD_DISPLAY') {
      return err('A CFD terminal cannot be paired to another CFD terminal')
    }

    const cfdExisting = await db.terminal.findUnique({ where: { id: cfdTerminalId } })
    if (!cfdExisting || cfdExisting.deletedAt) {
      return notFound('CFD terminal not found')
    }

    // C6: Enforce 1:1 — if this CFD is already paired to another register, clear it first
    await (db.terminal.updateMany as any)({
      where: {
        cfdTerminalId,
        id: { not: id },
        deletedAt: null,
      },
      data: {
        cfdTerminalId: null,
        cfdIpAddress: null,
        cfdConnectionMode: null,
        lastMutatedBy: 'local',
      },
    })

    const terminal = await (db.terminal.update as any)({
      where: { id },
      data: {
        cfdTerminalId,
        cfdIpAddress: cfdIpAddress || null,
        cfdConnectionMode: cfdConnectionMode || 'usb',
        cfdSerialNumber: cfdSerialNumber || null,
        lastMutatedBy: 'local',
      },
      include: {
        cfdTerminal: {
          select: {
            id: true,
            name: true,
            category: true,
            cfdIpAddress: true,
            cfdConnectionMode: true,
            cfdSerialNumber: true,
            lastSeenAt: true,
          },
        },
      },
    })

    if (previousCfdTerminalId && previousCfdTerminalId !== cfdTerminalId) {
      dispatchCFDIdle(existing.locationId, previousCfdTerminalId)
      clearCfdMapping(previousCfdTerminalId)
    }
    setCfdMapping(cfdTerminalId, id)

    // Best-effort: mark the CFD terminal's category as CFD_DISPLAY
    try {
      if ((cfdExisting as any).category !== 'CFD_DISPLAY') {
        await (db.terminal.update as any)({
          where: { id: cfdTerminalId },
          data: { category: 'CFD_DISPLAY', lastMutatedBy: 'local' },
        })
      }
    } catch (catErr) {
      console.error('Failed to update CFD terminal category:', catErr)
    }

    void notifyDataChanged({ locationId: existing.locationId, domain: 'hardware', action: 'updated', entityId: id })
    void pushUpstream()

    return ok({ terminal })
  } catch (error) {
    console.error('Failed to pair CFD terminal:', error)
    return err('Failed to pair CFD terminal', 500)
  }
}))

// DELETE — Unlink the CFD terminal from a register
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await db.terminal.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return notFound('Terminal not found')
    }

    const previousCfdTerminalId = existing.cfdTerminalId ?? null

    await (db.terminal.update as any)({
      where: { id },
      data: {
        cfdTerminalId: null,
        cfdIpAddress: null,
        cfdConnectionMode: null,
        cfdSerialNumber: null,
        lastMutatedBy: 'local',
      },
    })

    if (previousCfdTerminalId) {
      dispatchCFDIdle(existing.locationId, previousCfdTerminalId)
      clearCfdMapping(previousCfdTerminalId)
    }

    void notifyDataChanged({ locationId: existing.locationId, domain: 'hardware', action: 'updated', entityId: id })
    void pushUpstream()

    return ok({ success: true })
  } catch (error) {
    console.error('Failed to unpair CFD terminal:', error)
    return err('Failed to unpair CFD terminal', 500)
  }
}))
