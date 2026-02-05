import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'

/**
 * GET /api/seats/cleanup-orphaned-labels?locationId=xxx
 *
 * Dry run - Reports orphaned virtual seat labels without modifying data.
 * Orphaned seats are seats with hyphenated labels (e.g., "Table 6-1")
 * but whose table is no longer part of a virtual group.
 *
 * Returns list of orphaned seats with current and correct labels.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const locationId = searchParams.get('locationId')

  if (!locationId) {
    return NextResponse.json({ error: 'locationId required' }, { status: 400 })
  }

  try {
    // Find orphaned seats: have hyphenated label but table not in virtual group
    const orphanedSeats = await db.seat.findMany({
      where: {
        deletedAt: null,
        label: { contains: '-' },
        table: {
          locationId,
          virtualGroupId: null,
          deletedAt: null,
        },
      },
      include: {
        table: { select: { id: true, name: true } }
      }
    })

    return NextResponse.json({
      data: {
        orphanedCount: orphanedSeats.length,
        orphanedSeats: orphanedSeats.map(s => ({
          tableId: s.tableId,
          tableName: s.table.name,
          seatId: s.id,
          currentLabel: s.label,
          correctLabel: String(s.seatNumber)
        }))
      }
    })
  } catch (error) {
    console.error('[CleanupOrphanedLabels] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to check orphaned labels' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/seats/cleanup-orphaned-labels?locationId=xxx
 *
 * Fixes orphaned virtual seat labels by resetting them to their seat number.
 * Updates all seats with hyphenated labels whose tables are no longer
 * in virtual groups.
 *
 * Returns count of fixed seats and errors.
 */
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const locationId = searchParams.get('locationId')

  if (!locationId) {
    return NextResponse.json({ error: 'locationId required' }, { status: 400 })
  }

  try {
    // Find orphaned seats
    const orphanedSeats = await db.seat.findMany({
      where: {
        deletedAt: null,
        label: { contains: '-' },
        table: {
          locationId,
          virtualGroupId: null,
          deletedAt: null,
        },
      },
    })

    if (orphanedSeats.length === 0) {
      return NextResponse.json({ data: { fixed: 0, errors: 0 } })
    }

    // Fix each seat
    let fixed = 0
    let errors = 0

    await db.$transaction(async (tx) => {
      for (const seat of orphanedSeats) {
        try {
          await tx.seat.update({
            where: { id: seat.id },
            data: { label: String(seat.seatNumber) }
          })
          fixed++
        } catch {
          errors++
        }
      }
    })

    // Notify clients of floor plan changes
    dispatchFloorPlanUpdate(locationId, { async: true })

    return NextResponse.json({
      data: { fixed, errors }
    })
  } catch (error) {
    console.error('[CleanupOrphanedLabels] POST error:', error)
    return NextResponse.json(
      { error: 'Failed to cleanup orphaned labels' },
      { status: 500 }
    )
  }
}
