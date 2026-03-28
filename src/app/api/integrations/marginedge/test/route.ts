import { NextRequest } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { MarginEdgeClient } from '@/lib/marginedge-client'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { db } from '@/lib/db'
import { err, notFound, ok } from '@/lib/api-response'

export const POST = withVenue(async function POST(request: NextRequest) {
  const location = await db.location.findFirst({ select: { id: true } })
  if (!location) return notFound('No location')

  const body = await request.json().catch(() => ({})) as { employeeId?: string }
  const actor = await getActorFromRequest(request)
  const resolvedEmployeeId = actor.employeeId ?? body.employeeId
  const auth = await requirePermission(resolvedEmployeeId, location.id, PERMISSIONS.SETTINGS_EDIT)
  if (!auth.authorized) {
    return err(auth.error, auth.status)
  }

  const settings = parseSettings(await getLocationSettings(location.id))
  const me = settings.marginEdge

  if (!me?.apiKey) {
    return ok({ success: false, message: 'MarginEdge API key is not configured.' })
  }

  const client = new MarginEdgeClient(me.apiKey, me.restaurantId)
  const result = await client.testConnection()

  if (result.success) {
    return ok({ success: true, message: `Connected to MarginEdge (${me.environment})` })
  } else {
    console.error('[marginedge/test] Connection test failed:', result.error)
    return ok({ success: false, message: 'Connection test failed. Check your API key and try again.' })
  }
})
