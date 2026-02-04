import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { DEFAULT_KITCHEN_TEMPLATE, DEFAULT_RECEIPT_TEMPLATE } from '@/types/print-settings'

const DEFAULT_LOCATION_ID = 'loc-1'

// GET all printers for a location
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId') || DEFAULT_LOCATION_ID
    const role = searchParams.get('role') // Filter by printerRole

    const printers = await db.printer.findMany({
      where: {
        locationId,
        ...(role && { printerRole: role }),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })

    return NextResponse.json({
      printers: printers.map((p) => ({
        ...p,
        port: p.port,
        paperWidth: p.paperWidth,
        sortOrder: p.sortOrder,
      })),
    })
  } catch (error) {
    console.error('Failed to fetch printers:', error)
    return NextResponse.json({ error: 'Failed to fetch printers' }, { status: 500 })
  }
}

// POST create a new printer
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId = DEFAULT_LOCATION_ID,
      name,
      printerType,
      model,
      ipAddress,
      port = 9100,
      printerRole = 'kitchen',
      isDefault = false,
      paperWidth = 80,
      supportsCut = true,
      printSettings,
    } = body

    // Validate required fields
    if (!name || !printerType || !ipAddress) {
      return NextResponse.json(
        { error: 'Name, printer type, and IP address are required' },
        { status: 400 }
      )
    }

    // Validate IP address format
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
    if (!ipv4Regex.test(ipAddress)) {
      return NextResponse.json({ error: 'Invalid IP address format' }, { status: 400 })
    }

    // If setting as default, unset other defaults for the same role
    if (isDefault) {
      await db.printer.updateMany({
        where: {
          locationId,
          printerRole,
          isDefault: true,
        },
        data: { isDefault: false },
      })
    }

    // Use provided printSettings or default based on role
    const defaultSettings = printerRole === 'receipt'
      ? DEFAULT_RECEIPT_TEMPLATE
      : DEFAULT_KITCHEN_TEMPLATE

    const printer = await db.printer.create({
      data: {
        locationId,
        name,
        printerType,
        model,
        ipAddress,
        port,
        printerRole,
        isDefault,
        paperWidth,
        supportsCut,
        printSettings: printSettings || defaultSettings,
      },
    })

    return NextResponse.json({ printer })
  } catch (error) {
    console.error('Failed to create printer:', error)
    // Check for unique constraint violation (name must be unique per location)
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json(
        { error: 'A printer with this name already exists at this location' },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Failed to create printer' }, { status: 500 })
  }
}
