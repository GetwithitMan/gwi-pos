import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'

// Table status validation
const VALID_STATUSES = ['available', 'occupied', 'dirty', 'reserved'] as const
type TableStatus = typeof VALID_STATUSES[number]

function isValidStatus(s: string | null): s is TableStatus {
  return s !== null && VALID_STATUSES.includes(s as TableStatus)
}

// GET - List all tables for a location
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const sectionId = searchParams.get('sectionId')
    const rawStatus = searchParams.get('status')
    const includeSeats = searchParams.get('includeSeats') === 'true'
    const includeOrders = searchParams.get('includeOrders') === 'true'
    const includeOrderItems = searchParams.get('includeOrderItems') === 'true'

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Validate status parameter
    const status = isValidStatus(rawStatus) ? rawStatus : undefined

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
        // Always include count (lightweight)
        _count: {
          select: {
            seats: { where: { isActive: true, deletedAt: null } },
          },
        },
        // Conditionally include orders
        ...(includeOrders ? {
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
        } : {}),
        // Conditionally include seats
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
        // Seat count from _count (always included, lightweight)
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
        sectionId: table.sectionId,  // Section ID for filtering
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
        virtualGroupOffsetX: table.virtualGroupOffsetX,
        virtualGroupOffsetY: table.virtualGroupOffsetY,
        // Seats (if requested)
        seats: includeSeats && 'seats' in table ? table.seats : [],
        // Current order info (if orders included)
        currentOrder: (includeOrders && 'orders' in table && table.orders[0]) ? {
          id: table.orders[0].id,
          orderNumber: table.orders[0].orderNumber,
          guestCount: table.orders[0].guestCount,
          total: Number(table.orders[0].total),
          openedAt: table.orders[0].createdAt.toISOString(),
          server: (table.orders[0] as any).employee?.displayName ||
            `${(table.orders[0] as any).employee?.firstName || ''} ${(table.orders[0] as any).employee?.lastName || ''}`.trim(),
          // Order items for info panel (if requested)
          items: includeOrderItems && 'items' in table.orders[0]
            ? ((table.orders[0] as any).items as Array<{ id: string; name: string; quantity: number; price: unknown }>).map((item) => ({
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

    const tableCapacity = capacity ?? 4
    const tableWidth = width ?? 100
    const tableHeight = height ?? 100
    const tableShape = shape ?? 'rectangle'
    const tableSeatPattern = seatPattern ?? 'all_around'
    const tableRotation = rotation ?? 0

    // Deterministic grid placement when position not specified
    let tablePosX = posX
    let tablePosY = posY

    if (posX === undefined || posY === undefined) {
      // Count existing tables in this section/location for grid positioning
      const existingTablesCount = await db.table.count({
        where: {
          locationId,
          sectionId: sectionId ?? null,
          deletedAt: null,
          isActive: true,
        },
      })

      // Auto-grid layout: 3 columns, deterministic spacing
      const GRID_COLS = 3
      const GRID_SPACING_X = 180
      const GRID_SPACING_Y = 150
      const GRID_START_X = 50
      const GRID_START_Y = 50

      const col = existingTablesCount % GRID_COLS
      const row = Math.floor(existingTablesCount / GRID_COLS)

      tablePosX = posX ?? (GRID_START_X + col * GRID_SPACING_X)
      tablePosY = posY ?? (GRID_START_Y + row * GRID_SPACING_Y)
    }

    // Create the table
    const table = await db.table.create({
      data: {
        locationId,
        sectionId: sectionId ?? null,
        name,
        abbreviation: abbreviation ?? null,
        capacity: tableCapacity,
        posX: tablePosX,
        posY: tablePosY,
        width: tableWidth,
        height: tableHeight,
        rotation: tableRotation,
        shape: tableShape,
        seatPattern: tableSeatPattern,
      },
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
    dispatchFloorPlanUpdate(locationId, { async: true })

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
