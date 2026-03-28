import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

// PUT - Reorder sections by updating sortOrder
export const PUT = withVenue(withAuth('ADMIN', async function PUT(req: Request) {
  try {
    const body = await req.json()
    const { locationId, roomIds } = body

    if (!locationId) {
      return err('locationId is required')
    }

    if (!roomIds || !Array.isArray(roomIds)) {
      return err('roomIds array required')
    }

    // Verify all sections belong to this location before updating
    const sections = await db.section.findMany({
      where: {
        id: { in: roomIds },
        locationId,
        deletedAt: null,
      },
      select: { id: true },
    })

    if (sections.length !== roomIds.length) {
      return notFound('One or more sections not found or access denied')
    }

    // Update sortOrder for each section in order
    await db.$transaction(
      roomIds.map((id: string, index: number) =>
        db.section.update({
          where: { id },
          data: { sortOrder: index },
        })
      )
    )

    pushUpstream()

    dispatchFloorPlanUpdate(locationId, { async: true })

    return ok({ success: true })
  } catch (error) {
    console.error('[sections/reorder] PUT error:', error)
    return err('Failed to reorder sections', 500)
  }
}))
