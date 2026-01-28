import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface SeatPosition {
  seatNumber: number
  label: string
  relativeX: number
  relativeY: number
  angle: number
}

// Generate seats arranged around a table
function generateSeatsAround(
  tableWidth: number,
  tableHeight: number,
  count: number,
  labelPattern: 'numeric' | 'alpha' | 'alphanumeric' = 'numeric'
): SeatPosition[] {
  const seats: SeatPosition[] = []
  const angleStep = 360 / count
  // Place seats 25px outside the table perimeter
  const radius = Math.max(tableWidth, tableHeight) / 2 + 25

  for (let i = 0; i < count; i++) {
    const angle = i * angleStep - 90 // Start from top
    const radians = (angle * Math.PI) / 180

    let label: string
    switch (labelPattern) {
      case 'alpha':
        label = String.fromCharCode(65 + i) // A, B, C...
        break
      case 'alphanumeric':
        label = `S${i + 1}` // S1, S2, S3...
        break
      default:
        label = String(i + 1) // 1, 2, 3...
    }

    seats.push({
      seatNumber: i + 1,
      label,
      relativeX: Math.round(Math.cos(radians) * radius),
      relativeY: Math.round(Math.sin(radians) * radius),
      angle: Math.round(angle + 90) % 360, // Face table center
    })
  }

  return seats
}

// Generate seats in a row (for bar seating)
function generateSeatsRow(
  tableWidth: number,
  count: number,
  labelPattern: 'numeric' | 'alpha' | 'alphanumeric' = 'numeric'
): SeatPosition[] {
  const seats: SeatPosition[] = []
  const spacing = tableWidth / (count + 1)

  for (let i = 0; i < count; i++) {
    let label: string
    switch (labelPattern) {
      case 'alpha':
        label = String.fromCharCode(65 + i)
        break
      case 'alphanumeric':
        label = `S${i + 1}`
        break
      default:
        label = String(i + 1)
    }

    seats.push({
      seatNumber: i + 1,
      label,
      relativeX: Math.round(spacing * (i + 1) - tableWidth / 2),
      relativeY: 30, // Below the table/bar
      angle: 0, // Face forward
    })
  }

  return seats
}

// Generate seats for a booth (3 sides)
function generateSeatsBooth(
  tableWidth: number,
  tableHeight: number,
  count: number,
  labelPattern: 'numeric' | 'alpha' | 'alphanumeric' = 'numeric'
): SeatPosition[] {
  const seats: SeatPosition[] = []
  const offset = 25 // Distance from table edge

  // Distribute seats: back has more, sides have fewer
  const backSeats = Math.ceil(count / 2)
  const sideSeats = Math.floor((count - backSeats) / 2)
  const leftSeats = sideSeats
  const rightSeats = count - backSeats - leftSeats

  let seatNum = 0

  // Left side (facing right)
  for (let i = 0; i < leftSeats; i++) {
    const y = -tableHeight / 2 + (tableHeight / (leftSeats + 1)) * (i + 1)
    const label = labelPattern === 'alpha'
      ? String.fromCharCode(65 + seatNum)
      : labelPattern === 'alphanumeric'
        ? `S${seatNum + 1}`
        : String(seatNum + 1)

    seats.push({
      seatNumber: seatNum + 1,
      label,
      relativeX: -tableWidth / 2 - offset,
      relativeY: Math.round(y),
      angle: 90,
    })
    seatNum++
  }

  // Back (facing forward)
  for (let i = 0; i < backSeats; i++) {
    const x = -tableWidth / 2 + (tableWidth / (backSeats + 1)) * (i + 1)
    const label = labelPattern === 'alpha'
      ? String.fromCharCode(65 + seatNum)
      : labelPattern === 'alphanumeric'
        ? `S${seatNum + 1}`
        : String(seatNum + 1)

    seats.push({
      seatNumber: seatNum + 1,
      label,
      relativeX: Math.round(x),
      relativeY: -tableHeight / 2 - offset,
      angle: 180,
    })
    seatNum++
  }

  // Right side (facing left)
  for (let i = 0; i < rightSeats; i++) {
    const y = -tableHeight / 2 + (tableHeight / (rightSeats + 1)) * (i + 1)
    const label = labelPattern === 'alpha'
      ? String.fromCharCode(65 + seatNum)
      : labelPattern === 'alphanumeric'
        ? `S${seatNum + 1}`
        : String(seatNum + 1)

    seats.push({
      seatNumber: seatNum + 1,
      label,
      relativeX: tableWidth / 2 + offset,
      relativeY: Math.round(y),
      angle: 270,
    })
    seatNum++
  }

  return seats
}

// POST - Auto-generate seats for a table based on capacity
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tableId } = await params
    const body = await request.json()
    const {
      count,
      arrangement = 'around',
      labelPattern = 'numeric',
      replaceExisting = true,
    } = body

    // Verify table exists and get details
    const table = await db.table.findUnique({
      where: { id: tableId },
      select: {
        id: true,
        locationId: true,
        capacity: true,
        width: true,
        height: true,
        shape: true,
      },
    })

    if (!table) {
      return NextResponse.json(
        { error: 'Table not found' },
        { status: 404 }
      )
    }

    const seatCount = count || table.capacity

    // Generate seat positions based on arrangement
    let seatPositions: SeatPosition[]
    switch (arrangement) {
      case 'row':
        seatPositions = generateSeatsRow(table.width, seatCount, labelPattern)
        break
      case 'booth':
        seatPositions = generateSeatsBooth(table.width, table.height, seatCount, labelPattern)
        break
      case 'around':
      default:
        seatPositions = generateSeatsAround(table.width, table.height, seatCount, labelPattern)
        break
    }

    // Use transaction to replace existing seats if requested
    const result = await db.$transaction(async (tx) => {
      if (replaceExisting) {
        // Soft delete existing seats
        await tx.seat.updateMany({
          where: { tableId, isActive: true },
          data: { isActive: false },
        })
      }

      // Create new seats
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
            },
          })
        )
      )

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
    })
  } catch (error) {
    console.error('Failed to auto-generate seats:', error)
    return NextResponse.json(
      { error: 'Failed to auto-generate seats' },
      { status: 500 }
    )
  }
}
