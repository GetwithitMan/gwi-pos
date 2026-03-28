import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'

// POST — Link a CFD terminal to a register terminal
export const POST = withVenue(withAuth('ADMIN', async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const { cfdTerminalId, cfdIpAddress, cfdConnectionMode, cfdSerialNumber } = body

    // Validate required field
    if (!cfdTerminalId) {
      return err('cfdTerminalId is required')
    }

    // Prevent pairing a terminal to itself
    if (cfdTerminalId === id) {
      return err('A terminal cannot be paired to itself')
    }

    // Find the register terminal
    const existing = await db.terminal.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return notFound('Terminal not found')
    }

    // Validate the register is not itself a CFD display
     
    if ((existing as any).category === 'CFD_DISPLAY') {
      return err('A CFD terminal cannot be paired to another CFD terminal')
    }

    // Find the CFD terminal
    const cfdExisting = await db.terminal.findUnique({ where: { id: cfdTerminalId } })
    if (!cfdExisting || cfdExisting.deletedAt) {
      return notFound('CFD terminal not found')
    }

    // Update the register terminal with CFD pairing info
     
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

    // Best-effort: mark the CFD terminal's category as CFD_DISPLAY
    try {
       
      if ((cfdExisting as any).category !== 'CFD_DISPLAY') {
         
        await (db.terminal.update as any)({
          where: { id: cfdTerminalId },
          data: { category: 'CFD_DISPLAY', lastMutatedBy: 'local' },
        })
      }
    } catch (err) {
      console.error('Failed to update CFD terminal category:', err)
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

    // Find the register terminal
    const existing = await db.terminal.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return notFound('Terminal not found')
    }

    // Clear CFD pairing fields
     
    await (db.terminal.update as any)({
      where: { id },
      data: {
        cfdTerminalId: null,
        cfdIpAddress: null,
        cfdConnectionMode: null,
        lastMutatedBy: 'local',
      },
    })

    void notifyDataChanged({ locationId: existing.locationId, domain: 'hardware', action: 'updated', entityId: id })
    void pushUpstream()

    return ok({ success: true })
  } catch (error) {
    console.error('Failed to unpair CFD terminal:', error)
    return err('Failed to unpair CFD terminal', 500)
  }
}))
