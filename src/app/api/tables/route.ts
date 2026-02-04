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

// Helper: Generate seat positions based on pattern
type SeatPattern = 'all_around' | 'front_only' | 'three_sides' | 'two_sides' | 'inside'

interface SeatPosition {
  seatNumber: number
  label: string
  relativeX: number
  relativeY: number
  angle: number
}

function generateSeatPositions(
  tableWidth: number,
  tableHeight: number,
  count: number,
  pattern: SeatPattern,
  tableShape?: string
): SeatPosition[] {
  // Auto-infer pattern from shape if default
  let effectivePattern = pattern
  if (pattern === 'all_around') {
    if (tableShape === 'bar') effectivePattern = 'front_only'
    else if (tableShape === 'booth') effectivePattern = 'inside'
  }

  const offset = 25 // Distance from table edge
  const seats: SeatPosition[] = []

  if (effectivePattern === 'front_only') {
    // Bar seating - seats along one side
    const spacing = tableWidth / (count + 1)
    for (let i = 0; i < count; i++) {
      seats.push({
        seatNumber: i + 1,
        label: String(i + 1),
        relativeX: Math.round(-tableWidth / 2 + spacing * (i + 1)),
        relativeY: tableHeight / 2 + offset,
        angle: 0,
      })
    }
  } else if (effectivePattern === 'inside') {
    // Booth - seats inside
    const backSeats = Math.ceil(count / 2)
    const frontSeats = count - backSeats
    let seatNum = 0

    for (let i = 0; i < backSeats; i++) {
      const x = -tableWidth / 2 + 15 + ((tableWidth - 30) / (backSeats + 1)) * (i + 1)
      seats.push({
        seatNumber: seatNum + 1,
        label: String(seatNum + 1),
        relativeX: Math.round(x),
        relativeY: -tableHeight / 4,
        angle: 180,
      })
      seatNum++
    }

    for (let i = 0; i < frontSeats; i++) {
      const x = -tableWidth / 2 + 15 + ((tableWidth - 30) / (frontSeats + 1)) * (i + 1)
      seats.push({
        seatNumber: seatNum + 1,
        label: String(seatNum + 1),
        relativeX: Math.round(x),
        relativeY: tableHeight / 4,
        angle: 0,
      })
      seatNum++
    }
  } else if (effectivePattern === 'three_sides') {
    // U-shape seating
    const frontSeats = Math.ceil(count / 2)
    const sideSeatsTotal = count - frontSeats
    const leftSeats = Math.floor(sideSeatsTotal / 2)
    const rightSeats = sideSeatsTotal - leftSeats
    let seatNum = 0

    for (let i = 0; i < leftSeats; i++) {
      const y = -tableHeight / 2 + (tableHeight / (leftSeats + 1)) * (i + 1)
      seats.push({
        seatNumber: seatNum + 1,
        label: String(seatNum + 1),
        relativeX: -tableWidth / 2 - offset,
        relativeY: Math.round(y),
        angle: 90,
      })
      seatNum++
    }

    for (let i = 0; i < frontSeats; i++) {
      const x = -tableWidth / 2 + (tableWidth / (frontSeats + 1)) * (i + 1)
      seats.push({
        seatNumber: seatNum + 1,
        label: String(seatNum + 1),
        relativeX: Math.round(x),
        relativeY: tableHeight / 2 + offset,
        angle: 0,
      })
      seatNum++
    }

    for (let i = 0; i < rightSeats; i++) {
      const y = -tableHeight / 2 + (tableHeight / (rightSeats + 1)) * (i + 1)
      seats.push({
        seatNumber: seatNum + 1,
        label: String(seatNum + 1),
        relativeX: tableWidth / 2 + offset,
        relativeY: Math.round(y),
        angle: 270,
      })
      seatNum++
    }
  } else if (effectivePattern === 'two_sides') {
    // Corner booth
    const frontSeats = Math.ceil(count / 2)
    const rightSeats = count - frontSeats
    let seatNum = 0

    for (let i = 0; i < frontSeats; i++) {
      const x = -tableWidth / 2 + (tableWidth / (frontSeats + 1)) * (i + 1)
      seats.push({
        seatNumber: seatNum + 1,
        label: String(seatNum + 1),
        relativeX: Math.round(x),
        relativeY: tableHeight / 2 + offset,
        angle: 0,
      })
      seatNum++
    }

    for (let i = 0; i < rightSeats; i++) {
      const y = -tableHeight / 2 + (tableHeight / (rightSeats + 1)) * (i + 1)
      seats.push({
        seatNumber: seatNum + 1,
        label: String(seatNum + 1),
        relativeX: tableWidth / 2 + offset,
        relativeY: Math.round(y),
        angle: 270,
      })
      seatNum++
    }
  } else {
    // all_around - distribute around perimeter starting from top-left corner
    const perimeter = 2 * (tableWidth + tableHeight)
    const spacing = perimeter / count
    let currentDist = 0 // Start at top-left corner (was spacing/2 which centered on top edge)

    for (let i = 0; i < count; i++) {
      let x = 0, y = 0, angle = 0

      if (currentDist < tableWidth) {
        x = -tableWidth / 2 + currentDist
        y = -tableHeight / 2 - offset
        angle = 180
      } else if (currentDist < tableWidth + tableHeight) {
        const sideDist = currentDist - tableWidth
        x = tableWidth / 2 + offset
        y = -tableHeight / 2 + sideDist
        angle = 270
      } else if (currentDist < 2 * tableWidth + tableHeight) {
        const sideDist = currentDist - tableWidth - tableHeight
        x = tableWidth / 2 - sideDist
        y = tableHeight / 2 + offset
        angle = 0
      } else {
        const sideDist = currentDist - 2 * tableWidth - tableHeight
        x = -tableWidth / 2 - offset
        y = tableHeight / 2 - sideDist
        angle = 90
      }

      seats.push({
        seatNumber: i + 1,
        label: String(i + 1),
        relativeX: Math.round(x),
        relativeY: Math.round(y),
        angle,
      })

      currentDist += spacing
      if (currentDist > perimeter) currentDist -= perimeter
    }
  }

  return seats
}

// POST - Create a new table (with auto-generated seats)
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
      skipSeatGeneration = false, // Option to skip auto-generation
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
    const tableSeatPattern = (seatPattern || 'all_around') as SeatPattern

    // Use transaction to create table and seats atomically
    const result = await db.$transaction(async (tx) => {
      // Create the table
      const table = await tx.table.create({
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

      // Auto-generate seats unless explicitly skipped
      let seats: Array<{
        id: string
        label: string
        seatNumber: number
        relativeX: number
        relativeY: number
        angle: number
        seatType: string
      }> = []

      if (!skipSeatGeneration && tableCapacity > 0) {
        const seatPositions = generateSeatPositions(
          tableWidth,
          tableHeight,
          tableCapacity,
          tableSeatPattern,
          tableShape
        )

        // Create all seats
        const createdSeats = await Promise.all(
          seatPositions.map(pos =>
            tx.seat.create({
              data: {
                locationId,
                tableId: table.id,
                label: pos.label,
                seatNumber: pos.seatNumber,
                relativeX: pos.relativeX,
                relativeY: pos.relativeY,
                angle: pos.angle,
                seatType: 'standard',
              },
            })
          )
        )

        seats = createdSeats.map(seat => ({
          id: seat.id,
          label: seat.label,
          seatNumber: seat.seatNumber,
          relativeX: seat.relativeX,
          relativeY: seat.relativeY,
          angle: seat.angle,
          seatType: seat.seatType,
        }))

        console.log(`[Tables] Auto-generated ${seats.length} seats for table ${table.name}`)
      }

      return { table, seats }
    })

    // Notify POS terminals of floor plan update
    dispatchFloorPlanUpdate(locationId, { async: true })

    return NextResponse.json({
      table: {
        id: result.table.id,
        name: result.table.name,
        abbreviation: result.table.abbreviation,
        capacity: result.table.capacity,
        posX: result.table.posX,
        posY: result.table.posY,
        width: result.table.width,
        height: result.table.height,
        rotation: result.table.rotation,
        shape: result.table.shape,
        seatPattern: result.table.seatPattern,
        status: result.table.status,
        section: result.table.section,
        combinedWithId: null,
        combinedTableIds: null,
        originalName: null,
        originalPosX: null,
        originalPosY: null,
        isLocked: false,
        seats: result.seats,
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
