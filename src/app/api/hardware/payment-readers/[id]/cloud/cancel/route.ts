import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getDatacapClient } from '@/lib/datacap/helpers'
import { getRequestLocationId } from '@/lib/request-context'
import { withAuth } from '@/lib/api-auth-middleware'
import { ok } from '@/lib/api-response'

/**
 * Cloud reader cancel proxy
 * Sends EMVPadReset to reset the cloud-connected reader to idle.
 * Called when user navigates away mid-transaction or explicitly cancels.
 */
export const POST = withVenue(withAuth(async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let cancelLocationId = getRequestLocationId()
    if (!cancelLocationId) {
      const reader = await db.paymentReader.findFirst({
        where: { id, deletedAt: null },
        select: { locationId: true },
      })
      if (!reader) {
        return ok({ success: false })
      }
      cancelLocationId = reader.locationId
    }

    const client = await getDatacapClient(cancelLocationId)
    await client.padReset(id)

    return ok({ success: true })
  } catch (error) {
    // Cancel errors are non-fatal — log and return gracefully
    console.error('[cloud/cancel] padReset failed:', error)
    return ok({ success: false })
  }
}))
