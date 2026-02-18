import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET single payment reader
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const reader = await db.paymentReader.findFirst({
      where: { id, deletedAt: null },
      include: {
        terminals: {
          select: {
            id: true,
            name: true,
            category: true,
          },
        },
        backupFor: {
          select: {
            id: true,
            name: true,
            category: true,
          },
        },
      },
    })

    if (!reader) {
      return NextResponse.json({ error: 'Payment reader not found' }, { status: 404 })
    }

    return NextResponse.json({
      reader: {
        ...reader,
        successRate: reader.successRate ? Number(reader.successRate) : null,
      },
    })
  } catch (error) {
    console.error('Failed to fetch payment reader:', error)
    return NextResponse.json({ error: 'Failed to fetch payment reader' }, { status: 500 })
  }
})

// PUT update payment reader
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await db.paymentReader.findFirst({
      where: { id, deletedAt: null },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Payment reader not found' }, { status: 404 })
    }

    const {
      name,
      serialNumber,
      ipAddress,
      port,
      verificationType,
      merchantId,
      terminalId,
      communicationMode,
      isActive,
      isOnline,
      lastSeenAt,
      lastError,
      lastErrorAt,
      firmwareVersion,
      avgResponseTime,
      successRate,
      sortOrder,
    } = body

    // Validate IP address format if provided (skip for simulated readers)
    if (ipAddress) {
      const resolvedMode = communicationMode || existing.communicationMode
      const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
      if (resolvedMode !== 'simulated' && !ipv4Regex.test(ipAddress)) {
        return NextResponse.json({ error: 'Invalid IP address format' }, { status: 400 })
      }
    }

    // Validate port range if provided
    if (port !== undefined && (port < 1 || port > 65535)) {
      return NextResponse.json({ error: 'Port must be between 1 and 65535' }, { status: 400 })
    }

    // Check for duplicate serial number (if changing)
    if (serialNumber && serialNumber !== existing.serialNumber) {
      const duplicateSerial = await db.paymentReader.findFirst({
        where: { serialNumber, deletedAt: null, id: { not: id } },
      })
      if (duplicateSerial) {
        return NextResponse.json(
          { error: 'A reader with this serial number already exists' },
          { status: 400 }
        )
      }
    }

    // Check for duplicate IP at this location (if changing)
    if (ipAddress && ipAddress !== existing.ipAddress) {
      const duplicateIp = await db.paymentReader.findFirst({
        where: { locationId: existing.locationId, ipAddress, deletedAt: null, id: { not: id } },
      })
      if (duplicateIp) {
        return NextResponse.json(
          { error: 'A reader with this IP address already exists at this location' },
          { status: 400 }
        )
      }
    }

    const reader = await db.paymentReader.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(serialNumber !== undefined && { serialNumber }),
        ...(ipAddress !== undefined && { ipAddress }),
        ...(port !== undefined && { port }),
        ...(verificationType !== undefined && { verificationType }),
        ...(merchantId !== undefined && { merchantId }),
        ...(terminalId !== undefined && { terminalId }),
        ...(communicationMode !== undefined && { communicationMode }),
        ...(isActive !== undefined && { isActive }),
        ...(isOnline !== undefined && { isOnline }),
        ...(lastSeenAt !== undefined && { lastSeenAt: lastSeenAt ? new Date(lastSeenAt) : null }),
        ...(lastError !== undefined && { lastError }),
        ...(lastErrorAt !== undefined && { lastErrorAt: lastErrorAt ? new Date(lastErrorAt) : null }),
        ...(firmwareVersion !== undefined && { firmwareVersion }),
        ...(avgResponseTime !== undefined && { avgResponseTime }),
        ...(successRate !== undefined && { successRate }),
        ...(sortOrder !== undefined && { sortOrder }),
      },
    })

    return NextResponse.json({
      reader: {
        ...reader,
        successRate: reader.successRate ? Number(reader.successRate) : null,
      },
    })
  } catch (error) {
    console.error('Failed to update payment reader:', error)
    return NextResponse.json({ error: 'Failed to update payment reader' }, { status: 500 })
  }
})

// DELETE payment reader (soft delete)
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const reader = await db.paymentReader.findFirst({
      where: { id, deletedAt: null },
      include: {
        terminals: true,
        backupFor: true,
      },
    })

    if (!reader) {
      return NextResponse.json({ error: 'Payment reader not found' }, { status: 404 })
    }

    // Check if reader is bound to any terminals
    if (reader.terminals.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete reader that is bound to terminals. Unbind first.' },
        { status: 400 }
      )
    }

    // Check if reader is backup for any terminals
    if (reader.backupFor.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete reader that is set as backup for terminals. Remove backup assignment first.' },
        { status: 400 }
      )
    }

    // Soft delete
    await db.paymentReader.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete payment reader:', error)
    return NextResponse.json({ error: 'Failed to delete payment reader' }, { status: 500 })
  }
})
