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

    // Scale include is separate — gracefully degrade if Scale table doesn't exist yet (pre-migration)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let terminalsWithScales: any[] = terminals.map((t) => ({ ...t, scale: null }))
    try {
      const withScales = await db.terminal.findMany({
        where: { locationId, deletedAt: null, scaleId: { not: null } },
        select: { id: true, scale: { select: { id: true, name: true, portPath: true, isConnected: true } } },
      })
      const scaleMap = new Map(withScales.map((t) => [t.id, t.scale]))
      terminalsWithScales = terminals.map((t) => ({ ...t, scale: scaleMap.get(t.id) ?? null }))
    } catch {
      // Scale table not yet migrated — terminals still work without scale data
    }

    return NextResponse.json({ data: { terminals: terminalsWithScales } })
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
      platform = 'BROWSER',
      staticIp,
      receiptPrinterId,
      roleSkipRules,
      scaleId,
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

    // Validate platform
    if (!['BROWSER', 'ANDROID', 'IOS'].includes(platform)) {
      return NextResponse.json(
        { error: 'Platform must be BROWSER, ANDROID, or IOS' },
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

    // Build create data — scaleId only if Scale table exists (post-migration)
    const createData: Record<string, unknown> = {
      locationId,
      name,
      category,
      platform,
      staticIp: staticIp || null,
      receiptPrinterId: receiptPrinterId || null,
      roleSkipRules: roleSkipRules || {},
    }

    // Only set scaleId if provided and Scale table exists
    const cleanScaleId = scaleId || null
    if (cleanScaleId) {
      try {
        const scale = await db.scale.findFirst({
          where: { id: cleanScaleId, deletedAt: null },
        })
        if (!scale) {
          return NextResponse.json({ error: 'Scale not found' }, { status: 400 })
        }
        createData.scaleId = cleanScaleId
      } catch {
        // Scale table not yet migrated — skip scaleId
      }
    }

    const terminal = await db.terminal.create({
      data: createData as Parameters<typeof db.terminal.create>[0]['data'],
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

    return NextResponse.json({ data: { terminal } })
  } catch (error) {
    console.error('Failed to create terminal:', error)
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json(
        { error: 'A terminal with this name already exists at this location' },
        { status: 400 }
      )
    }
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: `Failed to create terminal: ${msg}` }, { status: 500 })
  }
})
