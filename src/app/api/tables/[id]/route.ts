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

// Helper to generate seat positions around a table
function generateSeatPositions(
  width: number,
  height: number,
  count: number,
  shape: string
): Array<{ seatNumber: number; label: string; relativeX: number; relativeY: number; angle: number }> {
  const seats: Array<{ seatNumber: number; label: string; relativeX: number; relativeY: number; angle: number }> = []
  const offset = 30 // Distance from table edge

  if (shape === 'circle') {
    // Distribute seats in a circle around the table
    // Start from top-left position (-135 degrees / -3π/4) and go clockwise
    const radius = Math.max(width, height) / 2 + offset
    const startAngle = -Math.PI * 3 / 4 // Top-left position (about 10:30)
    for (let i = 0; i < count; i++) {
      const angle = startAngle + (i / count) * 2 * Math.PI
      seats.push({
        seatNumber: i + 1,
        label: String(i + 1),
        relativeX: Math.round(Math.cos(angle) * radius),
        relativeY: Math.round(Math.sin(angle) * radius),
        angle: Math.round((angle * 180) / Math.PI + 90) % 360,
      })
    }
  } else {
    // Rectangle/square/booth - distribute around perimeter
    // Start from top-left corner and go clockwise
    const perimeter = 2 * (width + height)
    const spacing = perimeter / count
    let currentDist = 0 // Start at top-left corner (was spacing/2 which centered on top edge)

    for (let i = 0; i < count; i++) {
      let x = 0, y = 0, seatAngle = 0

      if (currentDist < width) {
        // Top edge
        x = -width / 2 + currentDist
        y = -height / 2 - offset
        seatAngle = 180
      } else if (currentDist < width + height) {
        // Right edge
        const sideDist = currentDist - width
        x = width / 2 + offset
        y = -height / 2 + sideDist
        seatAngle = 270
      } else if (currentDist < 2 * width + height) {
        // Bottom edge
        const sideDist = currentDist - width - height
        x = width / 2 - sideDist
        y = height / 2 + offset
        seatAngle = 0
      } else {
        // Left edge
        const sideDist = currentDist - 2 * width - height
        x = -width / 2 - offset
        y = height / 2 - sideDist
        seatAngle = 90
      }

      seats.push({
        seatNumber: i + 1,
        label: String(i + 1),
        relativeX: Math.round(x),
        relativeY: Math.round(y),
        angle: seatAngle,
      })

      currentDist += spacing
    }
  }

  return seats
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
      locationId, // Need this for creating seats
    } = body

    // Get current table to check if capacity/shape changed
    const currentTable = await db.table.findUnique({
      where: { id },
      include: { seats: { where: { isActive: true, deletedAt: null } } },
    })

    if (!currentTable) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    }

    const newCapacity = capacity ?? currentTable.capacity
    const newWidth = width ?? currentTable.width
    const newHeight = height ?? currentTable.height
    const newShape = shape ?? currentTable.shape
    const currentSeatCount = currentTable.seats.length
    const tableLocationId = locationId || currentTable.locationId

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

    // Handle seat changes if capacity increased or decreased
    if (newCapacity !== currentSeatCount) {
      if (newCapacity > currentSeatCount) {
        // Add new seats
        const newPositions = generateSeatPositions(newWidth, newHeight, newCapacity, newShape)

        // Only create seats for the new positions (beyond current count)
        const seatsToCreate = newPositions.slice(currentSeatCount)

        if (seatsToCreate.length > 0) {
          await db.seat.createMany({
            data: seatsToCreate.map(pos => ({
              tableId: id,
              locationId: tableLocationId,
              seatNumber: pos.seatNumber,
              label: pos.label,
              relativeX: pos.relativeX,
              relativeY: pos.relativeY,
              angle: pos.angle,
              seatType: 'standard',
            })),
          })
        }
      } else {
        // Remove excess seats (HARD delete from highest seatNumber down)
        // Hard delete required because unique constraint (tableId, seatNumber)
        // would conflict with soft-deleted seats when recreating
        const seatsToRemove = currentTable.seats
          .sort((a, b) => b.seatNumber - a.seatNumber)
          .slice(0, currentSeatCount - newCapacity)

        if (seatsToRemove.length > 0) {
          await db.seat.deleteMany({
            where: { id: { in: seatsToRemove.map(s => s.id) } },
          })
        }
      }
    }

    // Fetch updated seats
    const updatedSeats = await db.seat.findMany({
      where: { tableId: id, isActive: true, deletedAt: null },
      orderBy: { seatNumber: 'asc' },
    })

    // Notify POS terminals of floor plan update
    dispatchFloorPlanUpdate(tableLocationId, { async: true })

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
        seats: updatedSeats.map(s => ({
          id: s.id,
          seatNumber: s.seatNumber,
          label: s.label,
          relativeX: s.relativeX,
          relativeY: s.relativeY,
          angle: s.angle,
        })),
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
