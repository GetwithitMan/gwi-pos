import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { normalizeCoord } from '@/lib/table-geometry'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { withVenue } from '@/lib/with-venue'

interface TablePositionUpdate {
  id: string
  posX: number
  posY: number
  width?: number
  height?: number
  rotation?: number
}

/**
 * Bulk update table positions in a single transaction
 * Used by the Floor Plan Editor for efficient saves
 *
 * IMPORTANT: All positions are normalized to grid alignment server-side
 * to ensure DB and UI are always on the same grid (prevents phantom "unsaved changes")
 */
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const { tables, locationId } = await request.json() as {
      tables: TablePositionUpdate[]
      locationId: string
    }

    if (!tables || !Array.isArray(tables) || tables.length === 0) {
      return NextResponse.json(
        { error: 'No tables provided for update' },
        { status: 400 }
      )
    }

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // Normalize all positions to grid alignment before saving
    // This ensures DB values match what the editor displays (same grid snapping)
    const normalizedTables = tables.map(t => ({
      ...t,
      posX: normalizeCoord(t.posX),
      posY: normalizeCoord(t.posY),
    }))

    // Perform all updates in a single transaction for atomicity
    // ALSO save as default positions to prevent layout getting wonky on reload
    const results = await db.$transaction(
      normalizedTables.map((t) =>
        db.table.update({
          where: {
            id: t.id,
            locationId, // Security: ensure table belongs to this location
          },
          data: {
            posX: t.posX,
            posY: t.posY,
            // Also save as default so positions persist on reload
            defaultPosX: t.posX,
            defaultPosY: t.posY,
            ...(t.width !== undefined && { width: Math.round(t.width) }),
            ...(t.height !== undefined && { height: Math.round(t.height) }),
            ...(t.rotation !== undefined && { rotation: t.rotation }),
            updatedAt: new Date(),
          },
        })
      )
    )

    // Notify POS terminals of bulk position updates
    dispatchFloorPlanUpdate(locationId, { async: true })

    // Notify cloud → NUC sync
    void notifyDataChanged({ locationId, domain: 'floorplan', action: 'updated' })

    return NextResponse.json({
      success: true,
      updated: results.length,
      tables: results.map(t => ({
        id: t.id,
        posX: t.posX,
        posY: t.posY,
        width: t.width,
        height: t.height,
      })),
    })
  } catch (error) {
    console.error('[Tables Bulk Update] Error:', error)
    return NextResponse.json(
      { error: 'Bulk update failed' },
      { status: 500 }
    )
  }
})
