import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { generateSeatPositions as generateSeatPositionsFromLib, type SeatPattern as LibSeatPattern } from '@/lib/seat-generation'
import { SEAT_RADIUS } from '@/lib/floorplan/constants'
import { withVenue } from '@/lib/with-venue'

type LabelPattern = 'numeric' | 'alpha' | 'alphanumeric'

// Helper function to generate seat labels
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

// Collision detection constants
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
export const POST = withVenue(async function POST(
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
      availableSpace, // Optional: space available around table (for dynamic compression)
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

    // Map local patterns to library patterns
    const patternMap: Record<string, LibSeatPattern> = {
      'all_around': 'all_around',
      'front_only': 'one_side',
      'two_sides': 'two_sides',
      'three_sides': 'booth', // Maps to booth pattern (3 sides)
      'inside': 'booth', // Maps to booth pattern
    }

    // Use provided pattern, or infer from table shape, or use table's existing pattern
    let localPattern = seatPattern || table.seatPattern || 'all_around'

    // Auto-infer pattern from shape if not explicitly set
    if (!seatPattern && table.seatPattern === 'all_around') {
      if (table.shape === 'bar') localPattern = 'front_only'
      else if (table.shape === 'booth') localPattern = 'inside'
    }

    // Map to library pattern
    const libraryPattern = patternMap[localPattern as string] || 'all_around'

    // Generate seat positions using library function
    const baseSeatPositions = generateSeatPositionsFromLib({
      shape: table.shape as 'rectangle' | 'square' | 'circle' | 'booth' | 'bar',
      pattern: libraryPattern,
      capacity: seatCount,
      width: table.width,
      height: table.height,
    })

    // Add labels to seat positions
    const seatPositions = baseSeatPositions.map((pos, index) => ({
      ...pos,
      label: getLabel(index, labelPattern as LabelPattern),
    }))

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
        // Hard delete existing seats - regeneration is a complete replacement
        // and soft-deleted seats would conflict with unique constraint on (tableId, seatNumber)
        const deleted = await tx.seat.deleteMany({
          where: { tableId },
        })
        deletedCount = deleted.count
      }

      // Update table's seatPattern if requested
      if (updateTablePattern && seatPattern) {
        await tx.table.update({
          where: { id: tableId },
          data: { seatPattern: localPattern },
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
              relativeX: Math.round(pos.relativeX),
              relativeY: Math.round(pos.relativeY),
              angle: Math.round(pos.angle),
              seatType: 'standard',
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
            seatPattern: localPattern,
            labelPattern,
          },
        },
      })

      return createdSeats
    })

    dispatchFloorPlanUpdate(table.locationId, { async: true })

    return NextResponse.json({ data: {
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
      seatPattern: localPattern,
      // Include collision warning if seats were forced despite collisions
      ...(collisionResult.hasCollisions ? {
        warning: 'Seats generated with collisions (forceGenerate was true)',
        collisions: collisionResult.collisions,
      } : {}),
    } })
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
})
