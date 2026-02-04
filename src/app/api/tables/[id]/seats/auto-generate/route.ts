import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type SeatPattern = 'all_around' | 'front_only' | 'three_sides' | 'two_sides' | 'inside'
type LabelPattern = 'numeric' | 'alpha' | 'alphanumeric'

interface SeatPosition {
  seatNumber: number
  label: string
  relativeX: number
  relativeY: number
  angle: number
}

function getLabel(index: number, pattern: LabelPattern): string {
  switch (pattern) {
    case 'alpha':
      return String.fromCharCode(65 + index) // A, B, C...
    case 'alphanumeric':
      return `S${index + 1}` // S1, S2, S3...
    default:
      return String(index + 1) // 1, 2, 3...
  }
}

// Generate seats distributed around all 4 sides of a rectangle
function generateSeatsAllAround(
  tableWidth: number,
  tableHeight: number,
  count: number,
  labelPattern: LabelPattern = 'numeric'
): SeatPosition[] {
  const seats: SeatPosition[] = []
  const offset = 25 // Distance from table edge
  const perimeter = 2 * (tableWidth + tableHeight)
  const spacing = perimeter / count

  let currentDist = 0 // Start at top-left corner (was spacing/2 which centered on top edge)

  for (let i = 0; i < count; i++) {
    let x = 0, y = 0, angle = 0

    if (currentDist < tableWidth) {
      // Top side
      x = -tableWidth / 2 + currentDist
      y = -tableHeight / 2 - offset
      angle = 180 // Facing down
    } else if (currentDist < tableWidth + tableHeight) {
      // Right side
      const sideDist = currentDist - tableWidth
      x = tableWidth / 2 + offset
      y = -tableHeight / 2 + sideDist
      angle = 270 // Facing left
    } else if (currentDist < 2 * tableWidth + tableHeight) {
      // Bottom side
      const sideDist = currentDist - tableWidth - tableHeight
      x = tableWidth / 2 - sideDist
      y = tableHeight / 2 + offset
      angle = 0 // Facing up
    } else {
      // Left side
      const sideDist = currentDist - 2 * tableWidth - tableHeight
      x = -tableWidth / 2 - offset
      y = tableHeight / 2 - sideDist
      angle = 90 // Facing right
    }

    seats.push({
      seatNumber: i + 1,
      label: getLabel(i, labelPattern),
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
  count: number,
  labelPattern: LabelPattern = 'numeric'
): SeatPosition[] {
  const seats: SeatPosition[] = []
  const offset = 25
  const spacing = tableWidth / (count + 1)

  for (let i = 0; i < count; i++) {
    seats.push({
      seatNumber: i + 1,
      label: getLabel(i, labelPattern),
      relativeX: Math.round(-tableWidth / 2 + spacing * (i + 1)),
      relativeY: tableHeight / 2 + offset,
      angle: 0, // Facing up toward the bar
    })
  }

  return seats
}

// Generate seats on 3 sides (against wall - no back seats)
function generateSeatsThreeSides(
  tableWidth: number,
  tableHeight: number,
  count: number,
  labelPattern: LabelPattern = 'numeric'
): SeatPosition[] {
  const seats: SeatPosition[] = []
  const offset = 25

  // Distribute: front gets more, sides split the rest
  const frontSeats = Math.ceil(count / 2)
  const sideSeatsTotal = count - frontSeats
  const leftSeats = Math.floor(sideSeatsTotal / 2)
  const rightSeats = sideSeatsTotal - leftSeats

  let seatNum = 0

  // Left side (facing right)
  for (let i = 0; i < leftSeats; i++) {
    const y = -tableHeight / 2 + (tableHeight / (leftSeats + 1)) * (i + 1)
    seats.push({
      seatNumber: seatNum + 1,
      label: getLabel(seatNum, labelPattern),
      relativeX: -tableWidth / 2 - offset,
      relativeY: Math.round(y),
      angle: 90,
    })
    seatNum++
  }

  // Front/bottom (facing up)
  for (let i = 0; i < frontSeats; i++) {
    const x = -tableWidth / 2 + (tableWidth / (frontSeats + 1)) * (i + 1)
    seats.push({
      seatNumber: seatNum + 1,
      label: getLabel(seatNum, labelPattern),
      relativeX: Math.round(x),
      relativeY: tableHeight / 2 + offset,
      angle: 0,
    })
    seatNum++
  }

  // Right side (facing left)
  for (let i = 0; i < rightSeats; i++) {
    const y = -tableHeight / 2 + (tableHeight / (rightSeats + 1)) * (i + 1)
    seats.push({
      seatNumber: seatNum + 1,
      label: getLabel(seatNum, labelPattern),
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
  count: number,
  labelPattern: LabelPattern = 'numeric'
): SeatPosition[] {
  const seats: SeatPosition[] = []
  const offset = 25

  // Split between front and right sides
  const frontSeats = Math.ceil(count / 2)
  const rightSeats = count - frontSeats

  let seatNum = 0

  // Front/bottom (facing up)
  for (let i = 0; i < frontSeats; i++) {
    const x = -tableWidth / 2 + (tableWidth / (frontSeats + 1)) * (i + 1)
    seats.push({
      seatNumber: seatNum + 1,
      label: getLabel(seatNum, labelPattern),
      relativeX: Math.round(x),
      relativeY: tableHeight / 2 + offset,
      angle: 0,
    })
    seatNum++
  }

  // Right side (facing left)
  for (let i = 0; i < rightSeats; i++) {
    const y = -tableHeight / 2 + (tableHeight / (rightSeats + 1)) * (i + 1)
    seats.push({
      seatNumber: seatNum + 1,
      label: getLabel(seatNum, labelPattern),
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
  count: number,
  labelPattern: LabelPattern = 'numeric'
): SeatPosition[] {
  const seats: SeatPosition[] = []
  const innerPadding = 15

  // Two rows: back and front of booth
  const backSeats = Math.ceil(count / 2)
  const frontSeats = count - backSeats

  let seatNum = 0

  // Back row (facing forward/down)
  for (let i = 0; i < backSeats; i++) {
    const x = -tableWidth / 2 + innerPadding + ((tableWidth - innerPadding * 2) / (backSeats + 1)) * (i + 1)
    seats.push({
      seatNumber: seatNum + 1,
      label: getLabel(seatNum, labelPattern),
      relativeX: Math.round(x),
      relativeY: -tableHeight / 4, // Upper portion
      angle: 180,
    })
    seatNum++
  }

  // Front row (facing back/up)
  for (let i = 0; i < frontSeats; i++) {
    const x = -tableWidth / 2 + innerPadding + ((tableWidth - innerPadding * 2) / (frontSeats + 1)) * (i + 1)
    seats.push({
      seatNumber: seatNum + 1,
      label: getLabel(seatNum, labelPattern),
      relativeX: Math.round(x),
      relativeY: tableHeight / 4, // Lower portion
      angle: 0,
    })
    seatNum++
  }

  return seats
}

// Generate seat positions based on pattern
function generateSeatPositions(
  tableWidth: number,
  tableHeight: number,
  count: number,
  pattern: SeatPattern,
  labelPattern: LabelPattern = 'numeric'
): SeatPosition[] {
  switch (pattern) {
    case 'front_only':
      return generateSeatsFrontOnly(tableWidth, tableHeight, count, labelPattern)
    case 'three_sides':
      return generateSeatsThreeSides(tableWidth, tableHeight, count, labelPattern)
    case 'two_sides':
      return generateSeatsTwoSides(tableWidth, tableHeight, count, labelPattern)
    case 'inside':
      return generateSeatsInside(tableWidth, tableHeight, count, labelPattern)
    case 'all_around':
    default:
      return generateSeatsAllAround(tableWidth, tableHeight, count, labelPattern)
  }
}

// POST - Auto-generate seats for a table based on capacity and pattern
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tableId } = await params
    const body = await request.json()
    const {
      count,
      seatPattern,
      labelPattern = 'numeric',
      replaceExisting = true,
      updateTablePattern = true, // Also update table's seatPattern field
      employeeId, // For audit logging
    } = body

    // Verify table exists and get details
    const table = await db.table.findUnique({
      where: { id: tableId },
      select: {
        id: true,
        name: true,
        locationId: true,
        capacity: true,
        width: true,
        height: true,
        shape: true,
        seatPattern: true,
      },
    })

    if (!table) {
      return NextResponse.json(
        { error: 'Table not found' },
        { status: 404 }
      )
    }

    const seatCount = count || table.capacity

    // Use provided pattern, or infer from table shape, or use table's existing pattern
    let pattern: SeatPattern = seatPattern || (table.seatPattern as SeatPattern) || 'all_around'

    // Auto-infer pattern from shape if not explicitly set
    if (!seatPattern && table.seatPattern === 'all_around') {
      if (table.shape === 'bar') pattern = 'front_only'
      else if (table.shape === 'booth') pattern = 'inside'
    }

    // Generate seat positions based on pattern
    const seatPositions = generateSeatPositions(
      table.width,
      table.height,
      seatCount,
      pattern,
      labelPattern as LabelPattern
    )

    // Use transaction to replace existing seats and optionally update table pattern
    const result = await db.$transaction(async (tx) => {
      let deletedCount = 0

      if (replaceExisting) {
        // Soft delete existing seats
        const deleted = await tx.seat.updateMany({
          where: { tableId, isActive: true },
          data: { isActive: false, deletedAt: new Date() },
        })
        deletedCount = deleted.count
      }

      // Update table's seatPattern if requested
      if (updateTablePattern && seatPattern) {
        await tx.table.update({
          where: { id: tableId },
          data: { seatPattern: pattern },
        })
      }

      // Create new seats with original positions saved as "builder defaults"
      const createdSeats = await Promise.all(
        seatPositions.map(pos =>
          tx.seat.create({
            data: {
              locationId: table.locationId,
              tableId,
              label: pos.label,
              seatNumber: pos.seatNumber,
              relativeX: pos.relativeX,
              relativeY: pos.relativeY,
              angle: pos.angle,
              seatType: 'standard',
              // Save as "builder default" for restore after combine/split
              originalRelativeX: pos.relativeX,
              originalRelativeY: pos.relativeY,
              originalAngle: pos.angle,
            },
          })
        )
      )

      // Audit log the seat regeneration
      await tx.auditLog.create({
        data: {
          locationId: table.locationId,
          employeeId: employeeId || null,
          action: 'seats_regenerated',
          entityType: 'table',
          entityId: tableId,
          details: {
            tableName: table.name || tableId,
            previousSeatsDeleted: deletedCount,
            newSeatsCreated: createdSeats.length,
            seatPattern: pattern,
            labelPattern,
          },
        },
      })

      console.log(`[Seats] Regenerated ${createdSeats.length} seats for table (deleted ${deletedCount} previous)`)

      return createdSeats
    })

    return NextResponse.json({
      seats: result.map(seat => ({
        id: seat.id,
        tableId: seat.tableId,
        label: seat.label,
        seatNumber: seat.seatNumber,
        relativeX: seat.relativeX,
        relativeY: seat.relativeY,
        angle: seat.angle,
        seatType: seat.seatType,
      })),
      generated: result.length,
      seatPattern: pattern,
    })
  } catch (error) {
    console.error('Failed to auto-generate seats:', error)
    return NextResponse.json(
      { error: 'Failed to auto-generate seats' },
      { status: 500 }
    )
  }
}
