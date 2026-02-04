import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'

// GET - Get a single table
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const table = await db.table.findUnique({
      where: { id },
      include: {
        section: {
          select: { id: true, name: true, color: true },
        },
        orders: {
          where: { status: 'open' },
          include: {
            employee: {
              select: { displayName: true, firstName: true, lastName: true },
            },
            items: {
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
}

// PUT - Update a table
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const {
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

    // Get current table
    const currentTable = await db.table.findUnique({
      where: { id },
    })

    if (!currentTable) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    }

    // Update table
    const table = await db.table.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(abbreviation !== undefined ? { abbreviation: abbreviation || null } : {}),
        ...(sectionId !== undefined ? { sectionId: sectionId || null } : {}),
        ...(capacity !== undefined ? { capacity } : {}),
        ...(posX !== undefined ? { posX } : {}),
        ...(posY !== undefined ? { posY } : {}),
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        ...(rotation !== undefined ? { rotation } : {}),
        ...(shape !== undefined ? { shape } : {}),
        ...(seatPattern !== undefined ? { seatPattern } : {}),
        ...(status !== undefined ? { status } : {}),
      },
      include: {
        section: {
          select: { id: true, name: true, color: true },
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
    console.error('Failed to update table:', error)
    return NextResponse.json(
      { error: 'Failed to update table' },
      { status: 500 }
    )
  }
}

// DELETE - Delete (deactivate) a table
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Check for open orders
    const openOrders = await db.order.count({
      where: { tableId: id, status: 'open' },
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
      data: { isActive: false },
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
}
