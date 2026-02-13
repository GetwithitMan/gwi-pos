import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'

/**
 * POST /api/tables/save-default-layout
 *
 * Saves the current table positions as the "default layout" for reset operations.
 * This allows admins to define the canonical position for each table,
 * which will be restored when "Reset to Default" is triggered.
 *
 * Payload:
 * {
 *   locationId: string,
 *   tables: [{ id, defaultPosX, defaultPosY, defaultSectionId? }]
 * }
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, tables } = body

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    if (!tables || !Array.isArray(tables) || tables.length === 0) {
      return NextResponse.json(
        { error: 'tables array is required' },
        { status: 400 }
      )
    }

    // Validate all tables exist and belong to this location
    const tableIds = tables.map((t: { id: string }) => t.id)
    const existingTables = await db.table.findMany({
      where: {
        id: { in: tableIds },
        locationId,
        deletedAt: null,
      },
      select: { id: true },
    })

    if (existingTables.length !== tableIds.length) {
      return NextResponse.json(
        { error: 'Some tables not found or do not belong to this location' },
        { status: 400 }
      )
    }

    // Update all tables with their default positions
    await db.$transaction(
      tables.map((t: { id: string; defaultPosX: number; defaultPosY: number; defaultSectionId?: string | null }) =>
        db.table.update({
          where: { id: t.id },
          data: {
            defaultPosX: t.defaultPosX,
            defaultPosY: t.defaultPosY,
            defaultSectionId: t.defaultSectionId ?? null,
          },
        })
      )
    )

    // Notify POS terminals of default layout save
    dispatchFloorPlanUpdate(locationId, { async: true })

    return NextResponse.json({
      data: {
        updatedCount: tables.length,
        message: `Default layout saved for ${tables.length} table(s)`,
      },
    })
  } catch (error) {
    console.error('[SaveDefaultLayout] Failed:', error)
    return NextResponse.json(
      { error: 'Failed to save default layout' },
      { status: 500 }
    )
  }
})
