import { NextRequest, NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { db } from '@/lib/db'
import { syncInvoicesForLocation } from '../_helpers'

export const POST = withVenue(async function POST(request: NextRequest) {
  const location = await db.location.findFirst({ select: { id: true } })
  if (!location) return NextResponse.json({ error: 'No location' }, { status: 404 })

  const body = await request.json().catch(() => ({})) as {
    employeeId?: string
    fromDate?: string
    toDate?: string
  }
  const actor = await getActorFromRequest(request)
  const resolvedEmployeeId = actor.employeeId ?? body.employeeId
  const auth = await requirePermission(resolvedEmployeeId, location.id, PERMISSIONS.SETTINGS_EDIT)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const settings = parseSettings(await getLocationSettings(location.id))
  const me = settings.marginEdge

  if (!me?.apiKey) {
    return NextResponse.json({ error: 'MarginEdge API key not configured' }, { status: 400 })
  }

  // Default: last 30 days
  const toDate = body.toDate || new Date().toISOString().split('T')[0]
  const fromDate = body.fromDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  try {
    const result = await syncInvoicesForLocation(
      location.id,
      me.apiKey,
      me.restaurantId,
      me.syncOptions,
      fromDate,
      toDate
    )

    await updateSyncTimestamp(location.id, {
      lastInvoiceSyncAt: new Date().toISOString(),
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: result.errors.length > 0 ? 'error' : 'success',
      lastSyncError: result.errors.length > 0 ? result.errors[0] : null,
    })

    return NextResponse.json({ data: result })
  } catch (err) {
    console.error('[marginedge/sync-invoices] Error:', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Failed to sync invoices from MarginEdge' }, { status: 500 })
  }
})

async function updateSyncTimestamp(locationId: string, updates: Record<string, unknown>): Promise<void> {
  try {
    const loc = await db.location.findUnique({ where: { id: locationId }, select: { settings: true } })
    if (!loc) return
    const parsed = parseSettings(loc.settings)
    await db.location.update({
      where: { id: locationId },
      data: { settings: { ...parsed, marginEdge: { ...parsed.marginEdge, ...updates } } as object },
    })
  } catch { /* non-fatal */ }
}
