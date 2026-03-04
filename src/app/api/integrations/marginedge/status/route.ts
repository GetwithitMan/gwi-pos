import { NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { db } from '@/lib/db'

export const GET = withVenue(async function GET() {
  const location = await db.location.findFirst({ select: { id: true } })
  if (!location) return NextResponse.json({ error: 'No location' }, { status: 404 })

  const settings = parseSettings(await getLocationSettings(location.id))
  const me = settings.marginEdge

  const hasApiKey = !!(me?.apiKey)
  const configured = !!(me?.enabled && hasApiKey)

  // Count product mappings
  let productMappings = 0
  try {
    productMappings = await db.marginEdgeProductMapping.count({
      where: { locationId: location.id, isActive: true },
    })
  } catch { /* table may not exist yet */ }

  return NextResponse.json({
    data: {
      enabled: me?.enabled ?? false,
      hasApiKey,
      configured,
      environment: me?.environment ?? 'production',
      lastSyncAt: me?.lastSyncAt ?? null,
      lastSyncStatus: me?.lastSyncStatus ?? null,
      lastSyncError: me?.lastSyncError ?? null,
      lastProductSyncAt: me?.lastProductSyncAt ?? null,
      lastInvoiceSyncAt: me?.lastInvoiceSyncAt ?? null,
      syncOptions: me?.syncOptions ?? null,
      productMappings,
    }
  })
})
