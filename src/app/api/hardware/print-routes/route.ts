import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

const DEFAULT_LOCATION_ID = 'loc-1'

// GET - List all print routes for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId') || DEFAULT_LOCATION_ID
    const routeType = searchParams.get('routeType') // Optional filter

    const routes = await db.printRoute.findMany({
      where: {
        locationId,
        deletedAt: null,
        ...(routeType && { routeType }),
      },
      include: {
        printer: {
          select: {
            id: true,
            name: true,
            printerType: true,
            ipAddress: true,
            port: true,
            printerRole: true,
            isActive: true,
          },
        },
      },
      orderBy: [{ priority: 'desc' }, { name: 'asc' }],
    })

    return NextResponse.json({ routes })
  } catch (error) {
    console.error('Failed to fetch print routes:', error)
    return NextResponse.json({ error: 'Failed to fetch print routes' }, { status: 500 })
  }
})

// POST - Create a new print route
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId = DEFAULT_LOCATION_ID,
      name,
      routeType,
      isActive = true,
      priority = 0,
      categoryIds,
      itemTypes,
      stationId,
      printerId,
      backupPrinterId,
      failoverTimeout = 5000,
      settings,
    } = body

    // Validate required fields
    if (!name || !routeType) {
      return NextResponse.json(
        { error: 'Name and route type are required' },
        { status: 400 }
      )
    }

    // Validate routeType
    const validRouteTypes = ['category', 'item_type', 'station', 'custom']
    if (!validRouteTypes.includes(routeType)) {
      return NextResponse.json(
        { error: `Invalid route type. Must be one of: ${validRouteTypes.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate printer exists if provided
    if (printerId) {
      const printer = await db.printer.findFirst({
        where: { id: printerId, locationId, deletedAt: null },
      })
      if (!printer) {
        return NextResponse.json(
          { error: 'Primary printer not found at this location' },
          { status: 400 }
        )
      }
    }

    // Validate backup printer exists if provided
    if (backupPrinterId) {
      const backupPrinter = await db.printer.findFirst({
        where: { id: backupPrinterId, locationId, deletedAt: null },
      })
      if (!backupPrinter) {
        return NextResponse.json(
          { error: 'Backup printer not found at this location' },
          { status: 400 }
        )
      }
    }

    const route = await db.printRoute.create({
      data: {
        locationId,
        name,
        routeType,
        isActive,
        priority,
        categoryIds: categoryIds ?? undefined,
        itemTypes: itemTypes ?? undefined,
        stationId: stationId ?? undefined,
        printerId: printerId ?? undefined,
        backupPrinterId: backupPrinterId ?? undefined,
        failoverTimeout,
        settings: settings ?? undefined,
      },
      include: {
        printer: {
          select: {
            id: true,
            name: true,
            printerType: true,
            ipAddress: true,
            port: true,
            printerRole: true,
            isActive: true,
          },
        },
      },
    })

    return NextResponse.json({ route })
  } catch (error) {
    console.error('Failed to create print route:', error)
    return NextResponse.json({ error: 'Failed to create print route' }, { status: 500 })
  }
})
