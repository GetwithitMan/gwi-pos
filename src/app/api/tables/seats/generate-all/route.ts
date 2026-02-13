import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { generateSeatPositions as generateSeatPositionsFromLib, type SeatPattern as LibSeatPattern } from '@/lib/seat-generation'
import { withVenue } from '@/lib/with-venue'

// Helper function to generate seat labels
function getLabel(index: number): string {
  return String(index + 1)
}

/**
 * POST /api/tables/seats/generate-all
 *
 * Bulk-generate seats for all tables that don't have any seats.
 * This is a one-time migration endpoint.
 */
export const POST = withVenue(async function POST(request: NextRequest) {
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

      // Map local patterns to library patterns
      const patternMap: Record<string, LibSeatPattern> = {
        'all_around': 'all_around',
        'front_only': 'one_side',
        'two_sides': 'two_sides',
        'three_sides': 'booth', // Maps to booth pattern (3 sides)
        'inside': 'booth', // Maps to booth pattern
      }

      // Determine seat pattern based on shape or stored pattern
      let localPattern = table.seatPattern || 'all_around'
      if (table.shape === 'bar') localPattern = 'front_only'
      else if (table.shape === 'booth') localPattern = 'inside'

      // Map to library pattern
      const libraryPattern = patternMap[localPattern as string] || 'all_around'

      // Generate seat positions using library function
      const baseSeatPositions = generateSeatPositionsFromLib({
        shape: table.shape as 'rectangle' | 'square' | 'round' | 'oval' | 'booth',
        pattern: libraryPattern,
        capacity: table.capacity,
        width: table.width,
        height: table.height,
      })

      // Add labels to seat positions
      const seatPositions = baseSeatPositions.map((pos, index) => ({
        ...pos,
        label: getLabel(index),
      }))

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

    }

    dispatchFloorPlanUpdate(locationId, { async: true })

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
})
