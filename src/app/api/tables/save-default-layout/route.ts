import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'
const log = createChildLogger('tables-save-default-layout')

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
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, tables } = body

    if (!locationId) {
      return err('locationId is required')
    }

    if (!tables || !Array.isArray(tables) || tables.length === 0) {
      return err('tables array is required')
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
      return err('Some tables not found or do not belong to this location')
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

    pushUpstream()

    // Notify POS terminals of default layout save
    void dispatchFloorPlanUpdate(locationId, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({
        updatedCount: tables.length,
        message: `Default layout saved for ${tables.length} table(s)`,
      })
  } catch (error) {
    console.error('[SaveDefaultLayout] Failed:', error)
    return err('Failed to save default layout', 500)
  }
}))
