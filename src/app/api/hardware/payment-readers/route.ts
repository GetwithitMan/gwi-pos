import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const DEFAULT_LOCATION_ID = 'loc-1'

// GET all payment readers for a location
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId') || DEFAULT_LOCATION_ID
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

    return NextResponse.json({
      readers: readers.map((r) => ({
        ...r,
        avgResponseTime: r.avgResponseTime,
        successRate: r.successRate ? Number(r.successRate) : null,
        // Mask serial number for security (show last 6)
        serialNumberMasked: r.serialNumber.length > 6
          ? `...${r.serialNumber.slice(-6)}`
          : r.serialNumber,
      })),
    })
  } catch (error) {
    console.error('Failed to fetch payment readers:', error)
    return NextResponse.json({ error: 'Failed to fetch payment readers' }, { status: 500 })
  }
}

// POST create a new payment reader
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId = DEFAULT_LOCATION_ID,
      name,
      serialNumber,
      ipAddress,
      port = 8080,
      verificationType = 'SERIAL_HANDSHAKE',
      merchantId,
      terminalId,
    } = body

    // Validate required fields
    if (!name || !serialNumber || !ipAddress) {
      return NextResponse.json(
        { error: 'Name, serial number, and IP address are required' },
        { status: 400 }
      )
    }

    // Validate IP address format
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
    if (!ipv4Regex.test(ipAddress)) {
      return NextResponse.json({ error: 'Invalid IP address format' }, { status: 400 })
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

    // Check for duplicate IP at this location
    const existingIp = await db.paymentReader.findFirst({
      where: { locationId, ipAddress, deletedAt: null },
    })
    if (existingIp) {
      return NextResponse.json(
        { error: 'A reader with this IP address already exists at this location' },
        { status: 400 }
      )
    }

    const reader = await db.paymentReader.create({
      data: {
        locationId,
        name,
        serialNumber,
        ipAddress,
        port,
        verificationType,
        merchantId,
        terminalId,
        isActive: true,
        isOnline: false,
      },
    })

    return NextResponse.json({ reader })
  } catch (error) {
    console.error('Failed to create payment reader:', error)
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json(
        { error: 'A reader with this name or IP already exists at this location' },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Failed to create payment reader' }, { status: 500 })
  }
}
