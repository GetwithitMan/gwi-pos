import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, ok } from '@/lib/api-response'

// GET - List all print routes for a location
export const GET = withVenue(withAuth('ADMIN', async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    if (!locationId) {
      return err('locationId is required')
    }
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

    return ok({ routes })
  } catch (error) {
    console.error('Failed to fetch print routes:', error)
    return err('Failed to fetch print routes', 500)
  }
}))

// POST - Create a new print route
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
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

    if (!locationId) {
      return err('locationId is required')
    }

    // Validate required fields
    if (!name || !routeType) {
      return err('Name and route type are required')
    }

    // Validate routeType
    const validRouteTypes = ['category', 'item_type', 'station', 'custom']
    if (!validRouteTypes.includes(routeType)) {
      return err(`Invalid route type. Must be one of: ${validRouteTypes.join(', ')}`)
    }

    // Validate printer exists if provided
    if (printerId) {
      const printer = await db.printer.findFirst({
        where: { id: printerId, locationId, deletedAt: null },
      })
      if (!printer) {
        return err('Primary printer not found at this location')
      }
    }

    // Validate backup printer exists if provided
    if (backupPrinterId) {
      const backupPrinter = await db.printer.findFirst({
        where: { id: backupPrinterId, locationId, deletedAt: null },
      })
      if (!backupPrinter) {
        return err('Backup printer not found at this location')
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

    void notifyDataChanged({ locationId, domain: 'hardware', action: 'created', entityId: route.id })
    void pushUpstream()

    return ok({ route })
  } catch (error) {
    console.error('Failed to create print route:', error)
    return err('Failed to create print route', 500)
  }
}))
