// src/app/api/floor-plan/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/floor-plan?locationId=xxx&sectionId=yyy&include=tables,seats,sections,entertainment,elements
 *
 * Returns complete floor plan data in a single call.
 * - tables: Table records with positions
 * - seats: Seat positions for all tables
 * - sections: Section/room definitions
 * - entertainment: Entertainment elements (pool tables, dartboards, etc.) with session data
 * - elements: Floor plan elements (walls, bars, etc.)
 *
 * Used by FloorPlanHome to load initial data.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const locationId = searchParams.get('locationId')
  const sectionId = searchParams.get('sectionId')
  const includeParam = searchParams.get('include')
  const include = includeParam
    ? includeParam.split(',').map(s => s.trim())
    : ['tables', 'seats', 'sections', 'entertainment', 'elements']

  if (!locationId) {
    return NextResponse.json(
      { error: 'locationId is required' },
      { status: 400 }
    )
  }

  try {
    // Fetch sections if requested
    const sections = include.includes('sections')
      ? await db.section.findMany({
          where: { locationId, deletedAt: null },
          select: {
            id: true,
            name: true,
            color: true,
            sortOrder: true,
          },
          orderBy: { sortOrder: 'asc' },
        })
      : []

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

    // Fetch tables with section info (if requested)
    const tables = include.includes('tables')
      ? await db.table.findMany({
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
      : []

    // Get all table IDs for seat and order queries
    const tableIds = tables.map(t => t.id)

    // Fetch seats for these tables (if requested)
    const seats = include.includes('seats') && tableIds.length > 0
      ? await db.seat.findMany({
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
      : []

    // Fetch entertainment elements (if requested)
    const entertainmentElements = include.includes('entertainment')
      ? await db.floorPlanElement.findMany({
          where: {
            locationId,
            elementType: 'entertainment',
            deletedAt: null,
          },
          include: {
            linkedMenuItem: {
              select: {
                id: true,
                name: true,
                price: true,
                blockTimeMinutes: true,
                entertainmentStatus: true,
                currentOrderId: true,
              },
            },
            waitlistEntries: {
              where: { status: 'waiting', deletedAt: null },
              select: { id: true },
            },
          },
          orderBy: { sortOrder: 'asc' },
        })
      : []

    // Transform entertainment data
    const transformedEntertainment = entertainmentElements.map(el => ({
      id: el.id,
      name: el.name,
      abbreviation: el.abbreviation,
      elementType: el.elementType,
      visualType: el.visualType,
      linkedMenuItemId: el.linkedMenuItemId,
      linkedMenuItem: el.linkedMenuItem,
      posX: el.posX,
      posY: el.posY,
      width: el.width,
      height: el.height,
      rotation: el.rotation,
      status: el.status || el.linkedMenuItem?.entertainmentStatus || 'available',
      currentOrderId: el.currentOrderId,
      sessionStartedAt: el.sessionStartedAt,
      sessionExpiresAt: el.sessionExpiresAt,
      waitlistCount: el.waitlistEntries?.length || 0,
      sectionId: el.sectionId,
    }))

    // Fetch floor plan elements (if requested)
    const elements = include.includes('elements')
      ? await db.floorPlanElement.findMany({
          where: { locationId, deletedAt: null },
          select: {
            id: true,
            name: true,
            elementType: true,
            visualType: true,
            posX: true,
            posY: true,
            width: true,
            height: true,
            rotation: true,
            linkedMenuItemId: true,
            linkedMenuItem: {
              select: {
                id: true,
                name: true,
                entertainmentStatus: true,
              },
            },
          },
        })
      : []

    // Fetch open orders for these tables (status = open or in_progress)
    const openOrders = tableIds.length > 0
      ? await db.order.findMany({
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
      : []

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

    // Build response based on include parameter
    const response: any = { data: {} }
    if (include.includes('tables')) response.data.tables = formattedTables
    if (include.includes('seats')) response.data.seats = formattedSeats
    if (include.includes('sections')) response.data.sections = sections
    if (include.includes('entertainment')) response.data.entertainment = transformedEntertainment
    if (include.includes('elements')) response.data.elements = elements

    return NextResponse.json(response)
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    console.error('[FloorPlan API] Error:', msg)

    return NextResponse.json(
      { error: 'Failed to load floor plan', details: msg },
      { status: 500 }
    )
  }
}
