import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { parseSettings } from '@/lib/settings'

// GET all payment readers for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }
    const activeOnly = searchParams.get('activeOnly') === 'true'

    const readers = await db.paymentReader.findMany({
      where: {
        locationId,
        deletedAt: null,
        ...(activeOnly && { isActive: true }),
      },
      include: {
        terminals: {
          select: {
            id: true,
            name: true,
            category: true,
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })

    return NextResponse.json({ data: {
      readers: readers.map((r) => ({
        ...r,
        avgResponseTime: r.avgResponseTime,
        successRate: r.successRate ? Number(r.successRate) : null,
        // Mask serial number for security (show last 6)
        serialNumberMasked: r.serialNumber.length > 6
          ? `...${r.serialNumber.slice(-6)}`
          : r.serialNumber,
      })),
    } })
  } catch (error) {
    console.error('Failed to fetch payment readers:', error)
    return NextResponse.json({ error: 'Failed to fetch payment readers' }, { status: 500 })
  }
})

// POST create a new payment reader
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      serialNumber,
      connectionType = 'IP',       // 'USB' | 'IP' | 'BLUETOOTH' | 'WIFI'
      ipAddress: rawIp,
      port = 8080,
      verificationType = 'SERIAL_HANDSHAKE',
      terminalId,
      communicationMode: rawMode,
      assignTerminalIds,           // string[] — terminals to bind on creation
    } = body
    // merchantId intentionally NOT accepted from client — sourced from location settings (MC-managed)

    // Validate required fields
    if (!locationId || !name || !serialNumber) {
      return NextResponse.json(
        { error: 'locationId, name, and serial number are required' },
        { status: 400 }
      )
    }

    // Connection-type rules
    const isNetworkType = connectionType === 'IP' || connectionType === 'WIFI'
    const ipAddress = isNetworkType ? (rawIp || '') : '127.0.0.1'
    // USB + BT go through DC Direct (localhost:8080); IP/WiFi talk directly — all modes are 'local'
    const communicationMode = rawMode ?? 'local'

    // For network readers, IP address is required and must be valid
    if (isNetworkType) {
      if (!ipAddress) {
        return NextResponse.json({ error: 'IP address is required for IP/WiFi readers' }, { status: 400 })
      }
      const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
      if (communicationMode !== 'simulated' && !ipv4Regex.test(ipAddress)) {
        return NextResponse.json({ error: 'Invalid IP address format' }, { status: 400 })
      }
    }

    // Validate port range
    if (port < 1 || port > 65535) {
      return NextResponse.json({ error: 'Port must be between 1 and 65535' }, { status: 400 })
    }

    // Check for duplicate serial number
    const existingSerial = await db.paymentReader.findFirst({
      where: { serialNumber, deletedAt: null },
    })
    if (existingSerial) {
      return NextResponse.json(
        { error: 'A reader with this serial number already exists' },
        { status: 400 }
      )
    }

    // Check for duplicate IP only for network readers
    if (isNetworkType && ipAddress !== '127.0.0.1') {
      const existingIp = await db.paymentReader.findFirst({
        where: { locationId, ipAddress, deletedAt: null },
      })
      if (existingIp) {
        return NextResponse.json(
          { error: 'A reader with this IP address already exists at this location' },
          { status: 400 }
        )
      }
    }

    // Pull MID from location settings — managed by Mission Control, never from client
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    })
    const locSettings = parseSettings(location?.settings)
    const merchantId = locSettings.payments?.datacapMerchantId || null

    const reader = await db.paymentReader.create({
      data: {
        locationId,
        name,
        serialNumber,
        connectionType,
        ipAddress,
        port,
        verificationType,
        merchantId,
        terminalId,
        communicationMode,
        isActive: true,
        isOnline: communicationMode === 'simulated',
      },
    })

    // Bind to terminals if provided
    if (Array.isArray(assignTerminalIds) && assignTerminalIds.length > 0) {
      await db.terminal.updateMany({
        where: { id: { in: assignTerminalIds }, locationId },
        data: { paymentReaderId: reader.id, paymentProvider: 'DATACAP_DIRECT' },
      })
    }

    return NextResponse.json({ data: { reader } })
  } catch (error) {
    console.error('Failed to create payment reader:', error)
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json(
        { error: 'A reader with this name already exists at this location' },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Failed to create payment reader' }, { status: 500 })
  }
})
