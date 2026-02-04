import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type SeatPattern = 'all_around' | 'front_only' | 'three_sides' | 'two_sides' | 'inside'

interface SeatPosition {
  seatNumber: number
  label: string
  relativeX: number
  relativeY: number
  angle: number
}

function getLabel(index: number): string {
  return String(index + 1)
}

// Generate seats distributed around all 4 sides of a rectangle
function generateSeatsAllAround(
  tableWidth: number,
  tableHeight: number,
  count: number
): SeatPosition[] {
  const seats: SeatPosition[] = []
  const offset = 25
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
      label: getLabel(i),
      relativeX: Math.round(x),
      relativeY: Math.round(y),
      angle,
    })

    currentDist += spacing
    if (currentDist > perimeter) currentDist -= perimeter
  }

  return seats
}

// Generate seats in a row on front/bottom side only (for bar seating)
function generateSeatsFrontOnly(
  tableWidth: number,
  tableHeight: number,
  count: number
): SeatPosition[] {
  const seats: SeatPosition[] = []
  const offset = 25
  const spacing = tableWidth / (count + 1)

  for (let i = 0; i < count; i++) {
    seats.push({
      seatNumber: i + 1,
      label: getLabel(i),
      relativeX: Math.round(-tableWidth / 2 + spacing * (i + 1)),
      relativeY: tableHeight / 2 + offset,
      angle: 0,
    })
  }

  return seats
}

// Generate seats on 3 sides (against wall)
function generateSeatsThreeSides(
  tableWidth: number,
  tableHeight: number,
  count: number
): SeatPosition[] {
  const seats: SeatPosition[] = []
  const offset = 25

  const frontSeats = Math.ceil(count / 2)
  const sideSeatsTotal = count - frontSeats
  const leftSeats = Math.floor(sideSeatsTotal / 2)
  const rightSeats = sideSeatsTotal - leftSeats

  let seatNum = 0

  for (let i = 0; i < leftSeats; i++) {
    const y = -tableHeight / 2 + (tableHeight / (leftSeats + 1)) * (i + 1)
    seats.push({
      seatNumber: seatNum + 1,
      label: getLabel(seatNum),
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
      label: getLabel(seatNum),
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
      label: getLabel(seatNum),
      relativeX: tableWidth / 2 + offset,
      relativeY: Math.round(y),
      angle: 270,
    })
    seatNum++
  }

  return seats
}

// Generate seats on 2 adjacent sides (corner booth)
function generateSeatsTwoSides(
  tableWidth: number,
  tableHeight: number,
  count: number
): SeatPosition[] {
  const seats: SeatPosition[] = []
  const offset = 25

  const frontSeats = Math.ceil(count / 2)
  const rightSeats = count - frontSeats

  let seatNum = 0

  for (let i = 0; i < frontSeats; i++) {
    const x = -tableWidth / 2 + (tableWidth / (frontSeats + 1)) * (i + 1)
    seats.push({
      seatNumber: seatNum + 1,
      label: getLabel(seatNum),
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
      label: getLabel(seatNum),
      relativeX: tableWidth / 2 + offset,
      relativeY: Math.round(y),
      angle: 270,
    })
    seatNum++
  }

  return seats
}

// Generate seats inside the table (booth interior)
function generateSeatsInside(
  tableWidth: number,
  tableHeight: number,
  count: number
): SeatPosition[] {
  const seats: SeatPosition[] = []
  const innerPadding = 15

  const backSeats = Math.ceil(count / 2)
  const frontSeats = count - backSeats

  let seatNum = 0

  for (let i = 0; i < backSeats; i++) {
    const x = -tableWidth / 2 + innerPadding + ((tableWidth - innerPadding * 2) / (backSeats + 1)) * (i + 1)
    seats.push({
      seatNumber: seatNum + 1,
      label: getLabel(seatNum),
      relativeX: Math.round(x),
      relativeY: -tableHeight / 4,
      angle: 180,
    })
    seatNum++
  }

  for (let i = 0; i < frontSeats; i++) {
    const x = -tableWidth / 2 + innerPadding + ((tableWidth - innerPadding * 2) / (frontSeats + 1)) * (i + 1)
    seats.push({
      seatNumber: seatNum + 1,
      label: getLabel(seatNum),
      relativeX: Math.round(x),
      relativeY: tableHeight / 4,
      angle: 0,
    })
    seatNum++
  }

  return seats
}

function generateSeatPositions(
  tableWidth: number,
  tableHeight: number,
  count: number,
  pattern: SeatPattern
): SeatPosition[] {
  switch (pattern) {
    case 'front_only':
      return generateSeatsFrontOnly(tableWidth, tableHeight, count)
    case 'three_sides':
      return generateSeatsThreeSides(tableWidth, tableHeight, count)
    case 'two_sides':
      return generateSeatsTwoSides(tableWidth, tableHeight, count)
    case 'inside':
      return generateSeatsInside(tableWidth, tableHeight, count)
    case 'all_around':
    default:
      return generateSeatsAllAround(tableWidth, tableHeight, count)
  }
}

/**
 * POST /api/tables/seats/generate-all
 *
 * Bulk-generate seats for all tables that don't have any seats.
 * This is a one-time migration endpoint.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, forceRegenerate = false, employeeId } = body

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // Get all active tables for this location
    const tables = await db.table.findMany({
      where: {
        locationId,
        isActive: true,
        deletedAt: null,
      },
      include: {
        seats: {
          where: { isActive: true, deletedAt: null },
          select: { id: true },
        },
      },
    })

    const results: { tableId: string; tableName: string; seatsGenerated: number }[] = []
    let skipped = 0

    for (const table of tables) {
      // Skip if table already has seats (unless forceRegenerate)
      if (table.seats.length > 0 && !forceRegenerate) {
        skipped++
        continue
      }

      // If forceRegenerate, soft-delete existing seats first
      if (forceRegenerate && table.seats.length > 0) {
        await db.seat.updateMany({
          where: {
            tableId: table.id,
            isActive: true,
          },
          data: {
            isActive: false,
            deletedAt: new Date(),
          },
        })
      }

      // Determine seat pattern based on shape or stored pattern
      let pattern: SeatPattern = (table.seatPattern as SeatPattern) || 'all_around'
      if (table.shape === 'bar') pattern = 'front_only'
      else if (table.shape === 'booth') pattern = 'inside'

      // Generate seat positions
      const seatPositions = generateSeatPositions(
        table.width,
        table.height,
        table.capacity,
        pattern
      )

      // Create seats in database
      await db.seat.createMany({
        data: seatPositions.map(pos => ({
          locationId,
          tableId: table.id,
          label: pos.label,
          seatNumber: pos.seatNumber,
          relativeX: pos.relativeX,
          relativeY: pos.relativeY,
          angle: pos.angle,
          seatType: 'standard',
        })),
      })

      results.push({
        tableId: table.id,
        tableName: table.name,
        seatsGenerated: seatPositions.length,
      })
    }

    // Create audit log for bulk operation
    if (results.length > 0) {
      await db.auditLog.create({
        data: {
          locationId,
          employeeId: employeeId || null,
          action: 'seats_bulk_generated',
          entityType: 'table',
          entityId: locationId, // Use locationId since this affects multiple tables
          details: {
            totalTables: tables.length,
            tablesUpdated: results.length,
            tablesSkipped: skipped,
            forceRegenerate,
            tableNames: results.map(r => r.tableName),
          },
        },
      })

      console.log(`[GenerateAllSeats] Generated seats for ${results.length} tables (${skipped} skipped)`)
    }

    return NextResponse.json({
      success: true,
      totalTables: tables.length,
      tablesUpdated: results.length,
      tablesSkipped: skipped,
      results,
    })
  } catch (error) {
    console.error('[GenerateAllSeats] Failed:', error)
    return NextResponse.json(
      { error: 'Failed to generate seats' },
      { status: 500 }
    )
  }
}
