// src/app/api/floor-plan/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/floor-plan?locationId=xxx&sectionId=yyy
 *
 * Returns tables and seats for the floor plan view.
 * Used by FloorPlanHomeV2 to load initial data.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const locationId = searchParams.get('locationId')
  const sectionId = searchParams.get('sectionId')

  if (!locationId) {
    return NextResponse.json(
      { error: 'locationId is required' },
      { status: 400 }
    )
  }

  try {
    // Build where clause for tables
    const tableWhere: {
      locationId: string
      deletedAt: null
      sectionId?: string
    } = {
      locationId,
      deletedAt: null,
    }

    if (sectionId) {
      tableWhere.sectionId = sectionId
    }

    // Fetch tables with section info
    const tables = await db.table.findMany({
      where: tableWhere,
      select: {
        id: true,
        name: true,
        sectionId: true,
        posX: true,
        posY: true,
        width: true,
        height: true,
        status: true,
        capacity: true,
        combinedWithId: true,
        combinedTableIds: true,
        virtualGroupId: true,
        virtualGroupPrimary: true,
        virtualGroupColor: true,
        section: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    })

    // Get all table IDs for seat and order queries
    const tableIds = tables.map(t => t.id)

    // Fetch seats for these tables
    const seats = await db.seat.findMany({
      where: {
        tableId: { in: tableIds },
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        tableId: true,
        label: true,
        seatNumber: true,
        relativeX: true,
        relativeY: true,
        angle: true,
      },
      orderBy: [{ tableId: 'asc' }, { seatNumber: 'asc' }],
    })

    // Fetch open orders for these tables (status = open or in_progress)
    const openOrders = await db.order.findMany({
      where: {
        tableId: { in: tableIds },
        status: { in: ['open', 'in_progress'] },
        deletedAt: null,
      },
      select: {
        id: true,
        orderNumber: true,
        tableId: true,
        status: true,
        total: true,
        createdAt: true,
        employee: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Create a map of tableId -> currentOrder (most recent open order)
    const ordersByTable = new Map<string, {
      id: string
      orderNumber: number
      total: number
      openedAt: string
      server: string
    }>()

    for (const order of openOrders) {
      if (order.tableId && !ordersByTable.has(order.tableId)) {
        ordersByTable.set(order.tableId, {
          id: order.id,
          orderNumber: order.orderNumber,
          total: Number(order.total),
          openedAt: order.createdAt.toISOString(),
          server: order.employee
            ? `${order.employee.firstName} ${order.employee.lastName || ''}`.trim()
            : 'Unknown',
        })
      }
    }

    // Format tables to match store shape (with currentOrder)
    const formattedTables = tables.map(t => ({
      id: t.id,
      name: t.name,
      sectionId: t.sectionId,
      posX: t.posX,
      posY: t.posY,
      width: t.width,
      height: t.height,
      status: t.status as 'available' | 'occupied' | 'dirty' | 'reserved',
      capacity: t.capacity,
      combinedWithId: t.combinedWithId,
      combinedTableIds: t.combinedTableIds as string[] | null,
      virtualGroupId: t.virtualGroupId,
      virtualGroupPrimary: t.virtualGroupPrimary,
      virtualGroupColor: t.virtualGroupColor,
      currentOrder: ordersByTable.get(t.id) || null,
    }))

    // Format seats to match store shape
    const formattedSeats = seats.map(s => ({
      id: s.id,
      tableId: s.tableId,
      label: s.label,
      seatNumber: s.seatNumber,
      relativeX: s.relativeX,
      relativeY: s.relativeY,
      angle: s.angle,
    }))

    return NextResponse.json({
      tables: formattedTables,
      seats: formattedSeats,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    console.error('[FloorPlan API] Error:', msg)

    return NextResponse.json(
      { error: 'Failed to load floor plan', details: msg },
      { status: 500 }
    )
  }
}
