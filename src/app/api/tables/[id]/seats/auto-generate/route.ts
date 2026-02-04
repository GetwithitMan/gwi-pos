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

// Collision detection constants
const SEAT_RADIUS = 12 // Seat visual radius for collision detection
const COLLISION_PADDING = 5 // Extra padding for collision checks

interface CollisionResult {
  hasCollisions: boolean
  collisions: {
    seatNumber: number
    collidedWith: string // 'table:T1' or 'fixture:Wall' or 'seat:T2-S3'
    type: 'table' | 'fixture' | 'seat'
  }[]
}

// Check if a point collides with a rectangle (with rotation support)
function pointInRotatedRect(
  px: number,
  py: number,
  rectX: number,
  rectY: number,
  rectW: number,
  rectH: number,
  rectRotation: number = 0
): boolean {
  // Get rect center
  const cx = rectX + rectW / 2
  const cy = rectY + rectH / 2

  // Translate point to rect's local space
  const dx = px - cx
  const dy = py - cy

  // Rotate point in opposite direction
  const rad = (-rectRotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const localX = dx * cos - dy * sin
  const localY = dx * sin + dy * cos

  // Check if local point is within rect bounds (with padding for seat radius)
  const halfW = rectW / 2 + SEAT_RADIUS + COLLISION_PADDING
  const halfH = rectH / 2 + SEAT_RADIUS + COLLISION_PADDING

  return Math.abs(localX) <= halfW && Math.abs(localY) <= halfH
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
      checkCollisions = true, // New: whether to check for collisions
      forceGenerate = false, // New: generate even if collisions detected
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
        posX: true,
        posY: true,
        rotation: true,
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

    // Check for collisions if requested
    let collisionResult: CollisionResult = { hasCollisions: false, collisions: [] }

    if (checkCollisions) {
      // Skip collision checks if table hasn't been positioned yet
      if (table.posX == null || table.posY == null) {
        console.warn('[Seats] Skipping collision check - table has no position yet')
        // Generate seats without collision checking
      } else {
        // Get all other tables in the location (for collision detection)
        const otherTables = await db.table.findMany({
          where: {
            locationId: table.locationId,
            id: { not: tableId },
            isActive: true,
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
            posX: true,
            posY: true,
            width: true,
            height: true,
            rotation: true,
            seats: {
              where: { isActive: true, deletedAt: null },
              select: {
                id: true,
                seatNumber: true,
                relativeX: true,
                relativeY: true,
              },
            },
          },
        })

        // Get all fixtures (walls, bars) in the location
        const fixtures = await db.floorPlanElement.findMany({
          where: {
            locationId: table.locationId,
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
            elementType: true,
            posX: true,
            posY: true,
            width: true,
            height: true,
            rotation: true,
          },
        })

        // Calculate table center for seat absolute positions
        const tableCenterX = (table.posX ?? 0) + table.width / 2
        const tableCenterY = (table.posY ?? 0) + table.height / 2
        const tableRotation = (table.rotation ?? 0) * Math.PI / 180
        const cos = Math.cos(tableRotation)
        const sin = Math.sin(tableRotation)

        // Check each generated seat for collisions
        for (const seat of seatPositions) {
          // Calculate absolute seat position (applying table rotation)
          const rotatedX = seat.relativeX * cos - seat.relativeY * sin
          const rotatedY = seat.relativeX * sin + seat.relativeY * cos
          const seatAbsX = tableCenterX + rotatedX
          const seatAbsY = tableCenterY + rotatedY

          // Check against other tables
          for (const otherTable of otherTables) {
            // Skip tables with invalid positions
            if (otherTable.posX == null || otherTable.posY == null) continue

            if (pointInRotatedRect(
              seatAbsX, seatAbsY,
              otherTable.posX, otherTable.posY,
              otherTable.width, otherTable.height,
              otherTable.rotation ?? 0
            )) {
              collisionResult.hasCollisions = true
              collisionResult.collisions.push({
                seatNumber: seat.seatNumber,
                collidedWith: `table:${otherTable.name || otherTable.id}`,
                type: 'table',
              })
            }

            // Check against seats of other tables
            const otherTableCenterX = otherTable.posX + otherTable.width / 2
            const otherTableCenterY = otherTable.posY + otherTable.height / 2
            const otherRotation = (otherTable.rotation ?? 0) * Math.PI / 180
            const otherCos = Math.cos(otherRotation)
            const otherSin = Math.sin(otherRotation)

            for (const otherSeat of otherTable.seats) {
              const otherRotatedX = otherSeat.relativeX * otherCos - otherSeat.relativeY * otherSin
              const otherRotatedY = otherSeat.relativeX * otherSin + otherSeat.relativeY * otherCos
              const otherSeatAbsX = otherTableCenterX + otherRotatedX
              const otherSeatAbsY = otherTableCenterY + otherRotatedY

              const distance = Math.hypot(seatAbsX - otherSeatAbsX, seatAbsY - otherSeatAbsY)
              if (distance < (SEAT_RADIUS * 2 + COLLISION_PADDING)) {
                collisionResult.hasCollisions = true
                collisionResult.collisions.push({
                  seatNumber: seat.seatNumber,
                  collidedWith: `seat:${otherTable.name || otherTable.id}-S${otherSeat.seatNumber}`,
                  type: 'seat',
                })
              }
            }
          }

          // Check against fixtures (walls, bars, etc.)
          for (const fixture of fixtures) {
            // Skip fixtures with invalid positions
            if (fixture.posX == null || fixture.posY == null) continue

            if (pointInRotatedRect(
              seatAbsX, seatAbsY,
              fixture.posX, fixture.posY,
              fixture.width, fixture.height,
              fixture.rotation ?? 0
            )) {
              collisionResult.hasCollisions = true
              collisionResult.collisions.push({
                seatNumber: seat.seatNumber,
                collidedWith: `fixture:${fixture.name || fixture.elementType}`,
                type: 'fixture',
              })
            }
          }
        }

        // Log collisions but proceed anyway - let the user arrange tables as needed
        if (collisionResult.hasCollisions) {
          console.warn(`[Seats] Detected ${collisionResult.collisions.length} potential collisions, proceeding anyway`)
        }
      } // End else block (table has valid position)
    } // End if (checkCollisions)

    // Use transaction to replace existing seats and optionally update table pattern
    const result = await db.$transaction(async (tx) => {
      let deletedCount = 0

      if (replaceExisting) {
        // Hard delete existing seats to avoid unique constraint violation
        // (tableId + seatNumber must be unique, soft delete doesn't clear this)
        const deleted = await tx.seat.deleteMany({
          where: { tableId },
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
      // Include collision warning if seats were forced despite collisions
      ...(collisionResult.hasCollisions ? {
        warning: 'Seats generated with collisions (forceGenerate was true)',
        collisions: collisionResult.collisions,
      } : {}),
    })
  } catch (error) {
    console.error('Failed to auto-generate seats:', error)
    // Return detailed error for debugging
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorStack = error instanceof Error ? error.stack : undefined
    return NextResponse.json(
      {
        error: 'Failed to auto-generate seats',
        details: errorMessage,
        stack: process.env.NODE_ENV === 'development' ? errorStack : undefined
      },
      { status: 500 }
    )
  }
}
