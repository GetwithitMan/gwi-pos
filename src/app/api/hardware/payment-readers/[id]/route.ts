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

    return NextResponse.json({ data: {
      reader: {
        ...reader,
        successRate: reader.successRate ? Number(reader.successRate) : null,
      },
    } })
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
      connectionType,
      ipAddress: rawIp,
      port,
      verificationType,
      // merchantId intentionally NOT accepted — managed by Mission Control via location settings
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
      assignTerminalIds,  // string[] — replace terminal assignments
    } = body

    // Resolve connection type for validation
    const resolvedConnectionType = connectionType ?? existing.connectionType
    const isNetworkType = resolvedConnectionType === 'IP' || resolvedConnectionType === 'WIFI'
    // For USB/BT, always store 127.0.0.1; for network, use provided value
    const ipAddress = rawIp !== undefined
      ? (isNetworkType ? rawIp : '127.0.0.1')
      : undefined

    // Validate IP address format if provided for network readers
    if (ipAddress && isNetworkType) {
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

    // Check for duplicate IP only for network readers (USB/BT share 127.0.0.1)
    if (ipAddress && isNetworkType && ipAddress !== existing.ipAddress && ipAddress !== '127.0.0.1') {
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
        ...(connectionType !== undefined && { connectionType }),
        ...(ipAddress !== undefined && { ipAddress }),
        ...(port !== undefined && { port }),
        ...(verificationType !== undefined && { verificationType }),
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

    // Update terminal assignments if provided
    if (Array.isArray(assignTerminalIds)) {
      // Remove this reader from all terminals that currently have it
      await db.terminal.updateMany({
        where: { paymentReaderId: id, locationId: existing.locationId },
        data: { paymentReaderId: null, paymentProvider: 'SIMULATED' },
      })
      // Assign to the new list
      if (assignTerminalIds.length > 0) {
        await db.terminal.updateMany({
          where: { id: { in: assignTerminalIds }, locationId: existing.locationId },
          data: { paymentReaderId: id, paymentProvider: 'DATACAP_DIRECT' },
        })
      }
    }

    return NextResponse.json({ data: {
      reader: {
        ...reader,
        successRate: reader.successRate ? Number(reader.successRate) : null,
      },
    } })
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

    // Soft delete — mangle name + serial so they can be reused immediately
    await db.paymentReader.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        name: `${reader.name}__deleted__${id}`,
        serialNumber: `${reader.serialNumber}__deleted__${id}`,
      },
    })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete payment reader:', error)
    return NextResponse.json({ error: 'Failed to delete payment reader' }, { status: 500 })
  }
})
