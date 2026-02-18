import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import crypto from 'crypto'
import { withVenue } from '@/lib/with-venue'

// GET all terminals for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }
    const category = searchParams.get('category') // Filter by category

    const terminals = await db.terminal.findMany({
      where: {
        locationId,
        deletedAt: null,
        ...(category && { category }),
      },
      include: {
        receiptPrinter: {
          select: {
            id: true,
            name: true,
            ipAddress: true,
            printerRole: true,
          },
        },
        backupTerminal: {
          select: {
            id: true,
            name: true,
            isOnline: true,
            lastSeenAt: true,
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })

    return NextResponse.json({ terminals })
  } catch (error) {
    console.error('Failed to fetch terminals:', error)
    return NextResponse.json({ error: 'Failed to fetch terminals' }, { status: 500 })
  }
})

// POST create a new terminal
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      category = 'FIXED_STATION',
      staticIp,
      receiptPrinterId,
      roleSkipRules,
    } = body

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Validate required fields
    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    // Validate category
    if (!['FIXED_STATION', 'HANDHELD'].includes(category)) {
      return NextResponse.json(
        { error: 'Category must be FIXED_STATION or HANDHELD' },
        { status: 400 }
      )
    }

    // Validate IP address format if provided
    if (staticIp) {
      const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
      if (!ipv4Regex.test(staticIp)) {
        return NextResponse.json({ error: 'Invalid IP address format' }, { status: 400 })
      }
    }

    // If receiptPrinterId is provided, verify it exists and is a receipt printer
    if (receiptPrinterId) {
      const printer = await db.printer.findUnique({
        where: { id: receiptPrinterId },
      })
      if (!printer) {
        return NextResponse.json({ error: 'Receipt printer not found' }, { status: 400 })
      }
      if (printer.printerRole !== 'receipt') {
        return NextResponse.json(
          { error: 'Selected printer must have receipt role' },
          { status: 400 }
        )
      }
    }

    const terminal = await db.terminal.create({
      data: {
        locationId,
        name,
        category,
        staticIp: staticIp || null,
        receiptPrinterId: receiptPrinterId || null,
        roleSkipRules: roleSkipRules || {},
      },
      include: {
        receiptPrinter: {
          select: {
            id: true,
            name: true,
            ipAddress: true,
            printerRole: true,
          },
        },
      },
    })

    return NextResponse.json({ terminal })
  } catch (error) {
    console.error('Failed to create terminal:', error)
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json(
        { error: 'A terminal with this name already exists at this location' },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Failed to create terminal' }, { status: 500 })
  }
})
