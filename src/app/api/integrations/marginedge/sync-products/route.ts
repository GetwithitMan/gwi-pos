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
    return err('MarginEdge API key not configured')
  }

  const client = new MarginEdgeClient(me.apiKey, me.restaurantId)

  try {
    const products = await client.getAllProducts()

    // Get existing mappings for this location
    const existingMappings = await db.marginEdgeProductMapping.findMany({
      where: { locationId: location.id, isActive: true },
      select: { marginEdgeProductId: true, inventoryItemId: true },
    })
    const mappedIds = new Set(existingMappings.map(m => m.marginEdgeProductId))

    const unmappedProducts = products.filter(p => !mappedIds.has(p.id))

    // Update lastProductSyncAt in settings
    await updateSyncTimestamp(location.id, { lastProductSyncAt: new Date().toISOString() })

    return ok({
        totalProducts: products.length,
        mappedCount: existingMappings.length,
        unmappedProducts,
      })
  } catch (caughtErr) {
    console.error('[marginedge/sync-products] Error:', err instanceof Error ? err.message : 'unknown')
    return err('Failed to sync products from MarginEdge', 500)
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
