import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import type { TipBankSettings, TipShareSettings } from '@/lib/settings'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getLocationSettings, invalidateLocationCache } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { dispatchSettingsUpdated } from '@/lib/socket-dispatch'
import { err, notFound, ok } from '@/lib/api-response'

// GET tip settings for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')

    if (!locationId) {
      return err('locationId is required')
    }

    // Permission check (soft mode — allow through if no employeeId sent yet)
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.TIPS_MANAGE_SETTINGS)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Use cached location settings instead of direct DB query (FIX-021)
    const cachedSettings = await getLocationSettings(locationId)
    const settings = parseSettings(cachedSettings)

    return ok({
      tipBank: settings.tipBank,
      tipShares: settings.tipShares,
    })
  } catch (error) {
    console.error('Failed to fetch tip settings:', error)
    return err('Failed to fetch tip settings', 500)
  }
})

// PUT update tip settings for a location
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, employeeId, tipBank, tipShares } = body as {
      locationId: string
      employeeId?: string
      tipBank?: Partial<TipBankSettings>
      tipShares?: Partial<TipShareSettings>
    }

    if (!locationId) {
      return err('locationId is required')
    }

    // Permission check
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.TIPS_MANAGE_SETTINGS)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { id: true, settings: true },
    })

    if (!location) {
      return notFound('Location not found')
    }

    // Parse current settings
    const currentSettings = parseSettings(location.settings)

    // Deep merge tipBank (including nested tipGuide)
    const mergedTipBank: TipBankSettings = {
      ...currentSettings.tipBank,
      ...(tipBank || {}),
      tipGuide: {
        ...currentSettings.tipBank.tipGuide,
        ...(tipBank?.tipGuide || {}),
        // Preserve percentages array if explicitly provided, otherwise keep current
        percentages: tipBank?.tipGuide?.percentages !== undefined
          ? tipBank.tipGuide.percentages
          : currentSettings.tipBank.tipGuide.percentages,
      },
    }

    // Deep merge tipShares
    const mergedTipShares: TipShareSettings = {
      ...currentSettings.tipShares,
      ...(tipShares || {}),
    }

    // Build the raw settings object for storage
    // We need the raw JSON, not the parsed/merged one, to avoid overwriting other sections
    const rawSettings = (location.settings as Record<string, unknown>) || {}

    const updatedRawSettings = {
      ...rawSettings,
      tipBank: mergedTipBank,
      tipShares: mergedTipShares,
    }

    await db.location.update({
      where: { id: locationId },
      data: {
        settings: updatedRawSettings as object,
      },
    })

    // Invalidate settings cache so subsequent reads see fresh data
    invalidateLocationCache(locationId)

    // Notify cloud sync + push upstream
    void notifyDataChanged({ locationId, domain: 'settings', action: 'updated' })
    void pushUpstream()

    // Emit settings:updated so all terminals refresh tip configuration
    void dispatchSettingsUpdated(locationId, { changedKeys: ['tipBank', 'tipShares'] }).catch(console.error)

    return ok({
      tipBank: mergedTipBank,
      tipShares: mergedTipShares,
    })
  } catch (error) {
    console.error('Failed to update tip settings:', error)
    return err('Failed to update tip settings', 500)
  }
})
