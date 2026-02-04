import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'

// GET - List all tables for a location
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const sectionId = searchParams.get('sectionId')
    const status = searchParams.get('status')
    const includeSeats = searchParams.get('includeSeats') === 'true'
    const includeOrderItems = searchParams.get('includeOrderItems') === 'true'

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const tables = await db.table.findMany({
      where: {
        locationId,
        isActive: true,
        deletedAt: null,
        ...(sectionId ? { sectionId } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        section: {
          select: { id: true, name: true, color: true },
        },
        orders: {
          where: { status: 'open', deletedAt: null },
          select: {
            id: true,
            orderNumber: true,
            guestCount: true,
            total: true,
            createdAt: true,
            employee: {
              select: { displayName: true, firstName: true, lastName: true },
            },
            ...(includeOrderItems ? {
              items: {
                where: { deletedAt: null },
                select: {
                  id: true,
                  name: true,
                  quantity: true,
                  price: true,
                },
                orderBy: { createdAt: 'asc' as const },
                take: 10, // Limit for performance
              },
            } : {}),
          },
        },
        ...(includeSeats ? {
          seats: {
            where: { isActive: true, deletedAt: null },
            select: {
              id: true,
              label: true,
              seatNumber: true,
              relativeX: true,
              relativeY: true,
              angle: true,
              seatType: true,
            },
            orderBy: { seatNumber: 'asc' },
          },
        } : {}),
      },
      orderBy: [
        { section: { name: 'asc' } },
        { name: 'asc' },
      ],
    })

    return NextResponse.json({
      tables: tables.map(table => ({
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
        // Combine fields (Skill 106/107)
        combinedWithId: table.combinedWithId,
        combinedTableIds: table.combinedTableIds as string[] | null,
        originalName: table.originalName,
        // Original position for reset-to-default (T017)
        originalPosX: table.originalPosX,
        originalPosY: table.originalPosY,
        // Locked status (T019) - bolted down furniture
        isLocked: table.isLocked,
        // Virtual combine fields
        virtualGroupId: table.virtualGroupId,
        virtualGroupPrimary: table.virtualGroupPrimary,
        virtualGroupColor: table.virtualGroupColor,
        // Seats (if requested)
        seats: includeSeats && 'seats' in table ? table.seats : [],
        // Current order info
        currentOrder: table.orders[0] ? {
          id: table.orders[0].id,
          orderNumber: table.orders[0].orderNumber,
          guestCount: table.orders[0].guestCount,
          total: Number(table.orders[0].total),
          openedAt: table.orders[0].createdAt.toISOString(),
          server: table.orders[0].employee?.displayName ||
            `${table.orders[0].employee?.firstName || ''} ${table.orders[0].employee?.lastName || ''}`.trim(),
          // Order items for info panel (if requested)
          items: includeOrderItems && 'items' in table.orders[0]
            ? (table.orders[0].items as Array<{ id: string; name: string; quantity: number; price: unknown }>).map((item) => ({
                id: item.id,
                name: item.name,
                quantity: item.quantity,
                price: Number(item.price),
              }))
            : undefined,
        } : null,
      })),
    })
  } catch (error) {
    console.error('Failed to fetch tables:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tables' },
      { status: 500 }
    )
  }
}

// POST - Create a new table
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      sectionId,
      name,
      abbreviation,
      capacity,
      posX,
      posY,
      width,
      height,
      rotation,
      shape,
      seatPattern,
    } = body

    if (!locationId || !name) {
      return NextResponse.json(
        { error: 'Location ID and name are required' },
        { status: 400 }
      )
    }

    const tableCapacity = capacity || 4
    const tableWidth = width || 100
    const tableHeight = height || 100
    const tableShape = shape || 'rectangle'
    const tableSeatPattern = seatPattern || 'all_around'

    // Create the table
    const table = await db.table.create({
      data: {
        locationId,
        sectionId: sectionId || null,
        name,
        abbreviation: abbreviation || null,
        capacity: tableCapacity,
        posX: posX || 0,
        posY: posY || 0,
        width: tableWidth,
        height: tableHeight,
        rotation: rotation || 0,
        shape: tableShape,
        seatPattern: tableSeatPattern,
      },
      include: {
        section: {
          select: { id: true, name: true, color: true },
        },
      },
    })

    // Notify POS terminals of floor plan update
    dispatchFloorPlanUpdate(locationId, { async: true })

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
        combinedWithId: null,
        combinedTableIds: null,
        originalName: null,
        originalPosX: null,
        originalPosY: null,
        isLocked: false,
        currentOrder: null,
      },
    })
  } catch (error) {
    console.error('Failed to create table:', error)
    return NextResponse.json(
      { error: 'Failed to create table' },
      { status: 500 }
    )
  }
}
