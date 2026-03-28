import { NextRequest } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { testConnection, evictToken } from '@/lib/oracle-pms-client'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { db } from '@/lib/db'
import { err, notFound, ok } from '@/lib/api-response'

export const POST = withVenue(async function POST(request: NextRequest) {
  const location = await db.location.findFirst({ select: { id: true } })
  if (!location) return notFound('No location')

  // Gate by SETTINGS_EDIT permission — prevents arbitrary users from probing OPERA
  const body = await request.json().catch(() => ({})) as { employeeId?: string }
  const actor = await getActorFromRequest(request)
  const resolvedEmployeeId = actor.employeeId ?? body.employeeId
  const auth = await requirePermission(resolvedEmployeeId, location.id, PERMISSIONS.SETTINGS_EDIT)
  if (!auth.authorized) {
    return err(auth.error, auth.status)
  }

  const settings = parseSettings(await getLocationSettings(location.id))
  const pms = settings.hotelPms

  if (!pms?.clientId || !pms.clientSecret || !pms.baseUrl || !pms.appKey) {
    return ok({ success: false, message: 'Oracle PMS credentials are not fully configured.' })
  }

  try {
    evictToken(location.id)   // Force fresh token fetch
    await testConnection(pms, location.id)
    // Safe message: environment and hotel ID are non-secret configuration values
    return ok({ success: true, message: `Connected to OPERA Cloud (${pms.environment}) — Hotel ID: ${pms.hotelId}` })
  } catch (err) {
    // Log real error server-side; return safe generic message to client
    console.error('[oracle-pms/test] Connection test failed:', err instanceof Error ? err.message : 'unknown')
    return ok({ success: false, message: 'Connection test failed. Check credentials and try again.' })
  }
})
