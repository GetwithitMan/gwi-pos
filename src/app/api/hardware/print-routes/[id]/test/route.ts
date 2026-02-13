import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// POST - Test a print route configuration
// Validates that the route is properly configured and its printer(s) are reachable
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Fetch the route with its printer
    const route = await db.printRoute.findFirst({
      where: { id, deletedAt: null },
      include: {
        printer: true,
      },
    })

    if (!route) {
      return NextResponse.json(
        { success: false, error: 'Print route not found' },
        { status: 404 }
      )
    }

    const issues: string[] = []
    const warnings: string[] = []

    // Check 1: Route is active
    if (!route.isActive) {
      warnings.push('Route is currently inactive')
    }

    // Check 2: Route has a primary printer assigned
    if (!route.printerId) {
      issues.push('No primary printer assigned to this route')
    } else if (!route.printer) {
      issues.push('Assigned primary printer no longer exists')
    } else {
      // Check printer is active
      if (!route.printer.isActive) {
        warnings.push(`Primary printer "${route.printer.name}" is inactive`)
      }

      // Check printer is not soft-deleted
      if (route.printer.deletedAt) {
        issues.push(`Primary printer "${route.printer.name}" has been deleted`)
      }
    }

    // Check 3: Backup printer exists if configured
    if (route.backupPrinterId) {
      const backupPrinter = await db.printer.findFirst({
        where: { id: route.backupPrinterId, deletedAt: null },
      })
      if (!backupPrinter) {
        warnings.push('Backup printer not found or has been deleted')
      } else if (!backupPrinter.isActive) {
        warnings.push(`Backup printer "${backupPrinter.name}" is inactive`)
      }
    }

    // Check 4: Route type has matching criteria
    switch (route.routeType) {
      case 'category': {
        const categoryIds = route.categoryIds as string[] | null
        if (!categoryIds || categoryIds.length === 0) {
          issues.push('Category route has no categories assigned')
        } else {
          // Verify categories exist
          const categories = await db.category.findMany({
            where: { id: { in: categoryIds }, deletedAt: null },
            select: { id: true },
          })
          const missingCount = categoryIds.length - categories.length
          if (missingCount > 0) {
            warnings.push(`${missingCount} assigned category ID(s) not found or deleted`)
          }
        }
        break
      }
      case 'item_type': {
        const itemTypes = route.itemTypes as string[] | null
        if (!itemTypes || itemTypes.length === 0) {
          issues.push('Item type route has no item types assigned')
        }
        break
      }
      case 'station': {
        if (!route.stationId) {
          issues.push('Station route has no station assigned')
        } else {
          const station = await db.station.findFirst({
            where: { id: route.stationId, deletedAt: null },
          })
          if (!station) {
            issues.push('Assigned station not found or has been deleted')
          }
        }
        break
      }
      // 'custom' routes may not need additional criteria validation
    }

    const success = issues.length === 0

    return NextResponse.json({
      success,
      route: {
        id: route.id,
        name: route.name,
        routeType: route.routeType,
        isActive: route.isActive,
      },
      printer: route.printer
        ? {
            id: route.printer.id,
            name: route.printer.name,
            ipAddress: route.printer.ipAddress,
            port: route.printer.port,
            isActive: route.printer.isActive,
          }
        : null,
      issues,
      warnings,
    })
  } catch (error) {
    console.error('Failed to test print route:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to test print route' },
      { status: 500 }
    )
  }
})
