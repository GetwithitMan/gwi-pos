import { NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { getCompanyUsers } from '@/lib/7shifts-client'
import { db } from '@/lib/db'

export const GET = withVenue(async function GET() {
  const location = await db.location.findFirst({ select: { id: true } })
  if (!location) return NextResponse.json({ error: 'No location' }, { status: 404 })

  const settings = parseSettings(await getLocationSettings(location.id))
  const s = settings.sevenShifts

  if (!s?.clientId || !s.clientSecret || !s.companyId || !s.companyGuid) {
    return NextResponse.json({ error: '7shifts not configured' }, { status: 400 })
  }

  try {
    const users = await getCompanyUsers(s, location.id)
    // Return only safe fields
    return NextResponse.json({
      data: users.map(u => ({
        id: u.id,
        first_name: u.first_name,
        last_name: u.last_name,
        email: u.email,
        role_ids: u.role_ids,
        department_ids: u.department_ids,
        location_ids: u.location_ids,
        is_active: u.is_active,
      })),
    })
  } catch (err) {
    console.error('[7shifts/users] Failed to fetch users:', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Failed to fetch 7shifts users' }, { status: 502 })
  }
})
