import { NextRequest, NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { MarginEdgeClient } from '@/lib/marginedge-client'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { db } from '@/lib/db'

export const POST = withVenue(async function POST(request: NextRequest) {
  const location = await db.location.findFirst({ select: { id: true } })
  if (!location) return NextResponse.json({ error: 'No location' }, { status: 404 })

  const body = await request.json().catch(() => ({})) as { employeeId?: string }
  const auth = await requirePermission(body.employeeId, location.id, PERMISSIONS.SETTINGS_EDIT)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const settings = parseSettings(await getLocationSettings(location.id))
  const me = settings.marginEdge

  if (!me?.apiKey) {
    return NextResponse.json({
      data: { success: false, message: 'MarginEdge API key is not configured.' }
    })
  }

  const client = new MarginEdgeClient(me.apiKey, me.restaurantId)
  const result = await client.testConnection()

  if (result.success) {
    return NextResponse.json({
      data: { success: true, message: `Connected to MarginEdge (${me.environment})` }
    })
  } else {
    console.error('[marginedge/test] Connection test failed:', result.error)
    return NextResponse.json({
      data: { success: false, message: 'Connection test failed. Check your API key and try again.' }
    })
  }
})
