import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { softDeleteData } from '@/lib/floorplan/queries'
import { Prisma } from '@prisma/client'
import { withVenue } from '@/lib/with-venue'

// GET - Get a single table
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    const table = await db.table.findFirst({
      where: { id, locationId, deletedAt: null },
      include: {
        section: {
          select: { id: true, name: true, color: true },
        },
        orders: {
          where: { status: 'open', deletedAt: null },
          include: {
            employee: {
              select: { displayName: true, firstName: true, lastName: true },
            },
            items: {
              where: { deletedAt: null },
              include: { modifiers: true },
            },
          },
        },
      },
    })

    if (!table) {
      return NextResponse.json(
        { error: 'Table not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      table: {
        id: table.id,
        name: table.name,
        abbreviation: table.abbreviation,
        capacity: table.capacity,
        posX: table.posX,
        posY: table.posY,
        width: table.width,
        height: table.height,
        rotation: table.rotation,
        shape: table.shape,
        status: table.status,
        section: table.section,
        currentOrder: table.orders[0] ? {
          id: table.orders[0].id,
          orderNumber: table.orders[0].orderNumber,
          guestCount: table.orders[0].guestCount,
          total: Number(table.orders[0].total),
          openedAt: table.orders[0].createdAt.toISOString(),
          server: table.orders[0].employee?.displayName ||
            `${table.orders[0].employee?.firstName || ''} ${table.orders[0].employee?.lastName || ''}`.trim(),
          items: table.orders[0].items.map(item => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            price: Number(item.price),
            modifiers: item.modifiers.map(m => ({
              name: m.name,
              price: Number(m.price),
            })),
          })),
        } : null,
      },
    })
  } catch (error) {
    console.error('Failed to fetch table:', error)
    return NextResponse.json(
      { error: 'Failed to fetch table' },
      { status: 500 }
    )
  }
})

// PUT - Update a table
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const {
      locationId,
      name,
      abbreviation,
      sectionId,
      capacity,
      posX,
      posY,
      width,
      height,
      rotation,
      shape,
      seatPattern,
      status,
    } = body

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // Verify table belongs to this location
    const existing = await db.table.findFirst({
      where: { id, locationId, deletedAt: null },
      select: { id: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    }

    // Check for duplicate table name across ALL rooms/sections in this location
    if (name !== undefined && name !== '') {
      const duplicate = await db.table.findFirst({
        where: {
          locationId,
          name: { equals: name, mode: 'insensitive' },
          isActive: true,
          deletedAt: null,
          id: { not: id },
        },
        select: { id: true, name: true },
      })

      if (duplicate) {
        return NextResponse.json(
          { error: `A table named "${duplicate.name}" already exists` },
          { status: 409 }
        )
      }
    }

    // Build type-safe update data
    const updateData: Prisma.TableUpdateInput = {}

    if (name !== undefined) updateData.name = name
    if (abbreviation !== undefined) updateData.abbreviation = abbreviation ?? null
    if (sectionId !== undefined) {
      updateData.section = sectionId ? { connect: { id: sectionId } } : { disconnect: true }
    }
    if (capacity !== undefined) updateData.capacity = capacity
    if (posX !== undefined) updateData.posX = posX
    if (posY !== undefined) updateData.posY = posY
    if (width !== undefined) updateData.width = width
    if (height !== undefined) updateData.height = height
    if (rotation !== undefined) updateData.rotation = rotation
    if (shape !== undefined) updateData.shape = shape
    if (seatPattern !== undefined) updateData.seatPattern = seatPattern
    if (status !== undefined) updateData.status = status

    // Update table
    const table = await db.table.update({
      where: { id },
      data: updateData,
      include: {
        section: {
          select: { id: true, name: true, color: true },
        },
        _count: {
          select: {
            seats: { where: { isActive: true, deletedAt: null } },
          },
        },
      },
    })

    // Notify POS terminals of floor plan update
    dispatchFloorPlanUpdate(table.locationId, { async: true })

    return NextResponse.json({
      table: {
        id: table.id,
        name: table.name,
        abbreviation: table.abbreviation,
        capacity: table.capacity,
        seatCount: table._count.seats,
        posX: table.posX,
        posY: table.posY,
        width: table.width,
        height: table.height,
        rotation: table.rotation,
        shape: table.shape,
        seatPattern: table.seatPattern,
        status: table.status,
        section: table.section,
      },
    })
  } catch (error) {
    // Handle Prisma P2025 error (record not found)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    }
    console.error('Failed to update table:', error)
    return NextResponse.json(
      { error: 'Failed to update table' },
      { status: 500 }
    )
  }
})

// DELETE - Delete (deactivate) a table
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // Verify table belongs to this location
    const existing = await db.table.findFirst({
      where: { id, locationId, deletedAt: null },
      select: { id: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    }

    // Check for open orders
    const openOrders = await db.order.count({
      where: { tableId: id, locationId, status: 'open' },
    })

    if (openOrders > 0) {
      return NextResponse.json(
        { error: 'Cannot delete table with open orders' },
        { status: 400 }
      )
    }

    // Soft delete and get locationId for socket dispatch
    const table = await db.table.update({
      where: { id },
      data: softDeleteData(),
      select: { locationId: true },
    })

    // Notify POS terminals of floor plan update
    dispatchFloorPlanUpdate(table.locationId, { async: true })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete table:', error)
    return NextResponse.json(
      { error: 'Failed to delete table' },
      { status: 500 }
    )
  }
})
