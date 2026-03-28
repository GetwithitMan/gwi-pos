import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { getCompanyUsers } from '@/lib/7shifts-client'
import { db } from '@/lib/db'
import { err, notFound, ok } from '@/lib/api-response'

export const GET = withVenue(async function GET() {
  const location = await db.location.findFirst({ select: { id: true } })
  if (!location) return notFound('No location')

  const settings = parseSettings(await getLocationSettings(location.id))
  const s = settings.sevenShifts

  if (!s?.clientId || !s.clientSecret || !s.companyId || !s.companyGuid) {
    return err('7shifts not configured')
  }

  try {
    const users = await getCompanyUsers(s, location.id)
    // Return only safe fields
    return ok(users.map(u => ({
        id: u.id,
        first_name: u.first_name,
        last_name: u.last_name,
        email: u.email,
        role_ids: u.role_ids,
        department_ids: u.department_ids,
        location_ids: u.location_ids,
        is_active: u.is_active,
      })))
  } catch (err) {
    console.error('[7shifts/users] Failed to fetch users:', err instanceof Error ? err.message : 'unknown')
    return err('Failed to fetch 7shifts users', 502)
  }
})
