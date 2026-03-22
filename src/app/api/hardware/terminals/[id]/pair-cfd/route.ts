import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'

// POST — Link a CFD terminal to a register terminal
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const { cfdTerminalId, cfdIpAddress, cfdConnectionMode, cfdSerialNumber } = body

    // Validate required field
    if (!cfdTerminalId) {
      return NextResponse.json({ error: 'cfdTerminalId is required' }, { status: 400 })
    }

    // Prevent pairing a terminal to itself
    if (cfdTerminalId === id) {
      return NextResponse.json(
        { error: 'A terminal cannot be paired to itself' },
        { status: 400 }
      )
    }

    // Find the register terminal
    const existing = await db.terminal.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Terminal not found' }, { status: 404 })
    }

    // Validate the register is not itself a CFD display
     
    if ((existing as any).category === 'CFD_DISPLAY') {
      return NextResponse.json(
        { error: 'A CFD terminal cannot be paired to another CFD terminal' },
        { status: 400 }
      )
    }

    // Find the CFD terminal
    const cfdExisting = await db.terminal.findUnique({ where: { id: cfdTerminalId } })
    if (!cfdExisting || cfdExisting.deletedAt) {
      return NextResponse.json({ error: 'CFD terminal not found' }, { status: 404 })
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

    return NextResponse.json({ data: { terminal } })
  } catch (error) {
    console.error('Failed to pair CFD terminal:', error)
    return NextResponse.json({ error: 'Failed to pair CFD terminal' }, { status: 500 })
  }
})

// DELETE — Unlink the CFD terminal from a register
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Find the register terminal
    const existing = await db.terminal.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Terminal not found' }, { status: 404 })
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

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to unpair CFD terminal:', error)
    return NextResponse.json({ error: 'Failed to unpair CFD terminal' }, { status: 500 })
  }
})
