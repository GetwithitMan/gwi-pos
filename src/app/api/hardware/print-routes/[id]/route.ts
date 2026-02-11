import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - Get a single print route by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const route = await db.printRoute.findFirst({
      where: { id, deletedAt: null },
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

    if (!route) {
      return NextResponse.json({ error: 'Print route not found' }, { status: 404 })
    }

    return NextResponse.json({ route })
  } catch (error) {
    console.error('Failed to fetch print route:', error)
    return NextResponse.json({ error: 'Failed to fetch print route' }, { status: 500 })
  }
}

// PUT - Update a print route
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    // Check route exists and is not soft-deleted
    const existingRoute = await db.printRoute.findFirst({
      where: { id, deletedAt: null },
    })

    if (!existingRoute) {
      return NextResponse.json({ error: 'Print route not found' }, { status: 404 })
    }

    const {
      name,
      routeType,
      isActive,
      priority,
      categoryIds,
      itemTypes,
      stationId,
      printerId,
      backupPrinterId,
      failoverTimeout,
      settings,
    } = body

    // Validate routeType if provided
    if (routeType !== undefined) {
      const validRouteTypes = ['category', 'item_type', 'station', 'custom']
      if (!validRouteTypes.includes(routeType)) {
        return NextResponse.json(
          { error: `Invalid route type. Must be one of: ${validRouteTypes.join(', ')}` },
          { status: 400 }
        )
      }
    }

    // Validate printer if provided
    if (printerId !== undefined && printerId !== null) {
      const printer = await db.printer.findFirst({
        where: { id: printerId, locationId: existingRoute.locationId, deletedAt: null },
      })
      if (!printer) {
        return NextResponse.json(
          { error: 'Primary printer not found at this location' },
          { status: 400 }
        )
      }
    }

    // Validate backup printer if provided
    if (backupPrinterId !== undefined && backupPrinterId !== null) {
      const backupPrinter = await db.printer.findFirst({
        where: { id: backupPrinterId, locationId: existingRoute.locationId, deletedAt: null },
      })
      if (!backupPrinter) {
        return NextResponse.json(
          { error: 'Backup printer not found at this location' },
          { status: 400 }
        )
      }
    }

    const route = await db.printRoute.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(routeType !== undefined && { routeType }),
        ...(isActive !== undefined && { isActive }),
        ...(priority !== undefined && { priority }),
        ...(categoryIds !== undefined && { categoryIds }),
        ...(itemTypes !== undefined && { itemTypes }),
        ...(stationId !== undefined && { stationId }),
        ...(printerId !== undefined && { printerId }),
        ...(backupPrinterId !== undefined && { backupPrinterId }),
        ...(failoverTimeout !== undefined && { failoverTimeout }),
        ...(settings !== undefined && { settings }),
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
    console.error('Failed to update print route:', error)
    return NextResponse.json({ error: 'Failed to update print route' }, { status: 500 })
  }
}

// DELETE - Soft delete a print route
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Check route exists and is not already soft-deleted
    const route = await db.printRoute.findFirst({
      where: { id, deletedAt: null },
    })

    if (!route) {
      return NextResponse.json({ error: 'Print route not found' }, { status: 404 })
    }

    // Soft delete
    await db.printRoute.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete print route:', error)
    return NextResponse.json({ error: 'Failed to delete print route' }, { status: 500 })
  }
}
