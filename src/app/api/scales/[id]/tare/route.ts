import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { scaleService } from '@/lib/scale/scale-service'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'

// POST - Send tare command to scale
export const POST = withVenue(withAuth('ADMIN', async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    let scale
    try {
      scale = await db.scale.findFirst({
        where: { id, locationId, deletedAt: null },
      })
    } catch {
      // Scale table doesn't exist on un-migrated DB
      return err('Scale feature not available - database migration required', 503)
    }
    if (!scale) {
      return notFound('Scale not found')
    }

    await scaleService.tare(id)

    return ok({ success: true })
  } catch (error) {
    console.error('Failed to tare scale:', error)
    const message = error instanceof Error ? error.message : 'Failed to tare scale'
    return err(message, 500)
  }
}))
