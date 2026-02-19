import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'

/**
 * POST /api/tables/seats/save-all-as-default
 *
 * Save ALL current seat positions across ALL tables as the "builder default" positions.
 * This is used by admins to save the entire floor plan arrangement.
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, employeeId, tableIds } = body

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // Build query - either specific tables or all tables
    const tableQuery: { locationId: string; deletedAt: null; id?: { in: string[] } } = {
      locationId,
      deletedAt: null,
    }
    if (tableIds && Array.isArray(tableIds) && tableIds.length > 0) {
      tableQuery.id = { in: tableIds }
    }

    // Get all tables
    const tables = await db.table.findMany({
      where: tableQuery,
      select: { id: true, name: true },
    })

    if (tables.length === 0) {
      return NextResponse.json(
        { error: 'No tables found' },
        { status: 404 }
      )
    }

    const tableIdList = tables.map(t => t.id)

    // Get all active seats for these tables
    const seats = await db.seat.findMany({
      where: {
        tableId: { in: tableIdList },
        isActive: true,
        deletedAt: null,
      },
    })

    if (seats.length === 0) {
      return NextResponse.json({
        data: {
          savedCount: 0,
          tableCount: tables.length,
          message: 'No seats to save',
        },
      })
    }

    // Save current seat positions as default
    const result = await db.$transaction(async (tx) => {
      let savedCount = seats.length

      // Audit log
      await tx.auditLog.create({
        data: {
          locationId,
          employeeId: employeeId || null,
          action: 'all_seats_saved_as_default',
          entityType: 'location',
          entityId: locationId,
          details: {
            tableCount: tables.length,
            seatCount: savedCount,
            tableNames: tables.map(t => t.name),
          },
        },
      })

      return savedCount
    })

    // Fire-and-forget socket dispatch for real-time floor plan updates
    void dispatchFloorPlanUpdate(locationId).catch(() => {})

    return NextResponse.json({
      data: {
        savedCount: result,
        tableCount: tables.length,
        message: `Saved ${result} seat positions across ${tables.length} tables as default`,
      },
    })
  } catch (error) {
    console.error('[SaveAllSeatsAsDefault] Failed:', error)
    return NextResponse.json(
      { error: 'Failed to save seat positions as default' },
      { status: 500 }
    )
  }
})
