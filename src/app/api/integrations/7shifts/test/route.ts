import { NextRequest } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { getLocations } from '@/lib/7shifts-client'
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
  const auth = await requirePermission(resolvedEmployeeId, location.id, PERMISSIONS.SETTINGS_INTEGRATIONS)
  if (!auth.authorized) {
    return err(auth.error, auth.status)
  }

  const settings = parseSettings(await getLocationSettings(location.id))
  const s = settings.sevenShifts

  if (!s?.clientId || !s.clientSecret || !s.companyId || !s.companyGuid) {
    return ok({ success: false, message: '7shifts credentials are not fully configured.' })
  }

  try {
    const locations = await getLocations(s, location.id)
    return ok({
        success: true,
        message: `Connected to 7shifts (${s.environment}) — ${locations.length} location(s) found.`,
      })
  } catch (err) {
    console.error('[7shifts/test] Connection test failed:', err instanceof Error ? err.message : 'unknown')
    return ok({ success: false, message: 'Connection test failed. Check credentials and try again.' })
  }
})
