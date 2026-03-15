import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import { MarginEdgeClient } from '@/lib/marginedge-client'
import { syncInvoicesForLocation } from '@/app/api/integrations/marginedge/_helpers'
import { verifyCronSecret } from '@/lib/cron-auth'

async function updateSyncStatus(locationId: string, updates: Record<string, unknown>): Promise<void> {
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

export async function GET(request: NextRequest) {
  // Verify cron secret
  const cronAuthError = verifyCronSecret(request.headers.get('Authorization'))
  if (cronAuthError) return cronAuthError

  const locations = await db.location.findMany({
    where: { deletedAt: null },
    select: { id: true, settings: true },
  })

  const results: Record<string, unknown> = {}

  for (const location of locations) {
    const settings = parseSettings(location.settings)
    const me = settings.marginEdge
    if (!me?.enabled || !me.apiKey) continue

    const client = new MarginEdgeClient(me.apiKey, me.restaurantId)
    const locationResult: Record<string, unknown> = {}

    // Sync yesterday's invoices
    if (me.syncOptions.syncInvoices) {
      try {
        const tz = (location as { timezone?: string }).timezone || 'America/Chicago'
        const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
        const yesterdayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Date.now() - 24 * 60 * 60 * 1000))

        const result = await syncInvoicesForLocation(
          location.id,
          me.apiKey,
          me.restaurantId,
          me.syncOptions,
          yesterdayStr,
          todayStr
        )

        locationResult.invoices = { imported: result.imported, costUpdates: result.costUpdates }
        await updateSyncStatus(location.id, {
          lastSyncAt: new Date().toISOString(),
          lastInvoiceSyncAt: new Date().toISOString(),
          lastSyncStatus: result.errors.length > 0 ? 'error' : 'success',
          lastSyncError: result.errors.length > 0 ? result.errors[0] : null,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown'
        locationResult.invoices = { error: msg.slice(0, 200) }
        await updateSyncStatus(location.id, {
          lastSyncAt: new Date().toISOString(),
          lastSyncStatus: 'error',
          lastSyncError: msg.slice(0, 500),
        })
      }
    }

    results[location.id] = locationResult
  }

  return NextResponse.json({ data: results })
}
