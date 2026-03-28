import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getLocationSettings, invalidateLocationCache } from '@/lib/location-cache'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withVenue } from '@/lib/with-venue'
import { err, notFound, ok } from '@/lib/api-response'

const DEFAULTS = {
  enabled: false,
  prepTime: 20,
  orderTypes: ['takeout'] as string[],
  allowSpecialRequests: true,
  maxOrdersPerWindow: null as number | null,
  windowMinutes: 15,
  surchargeType: null as string | null,
  surchargeAmount: 0,
  surchargeName: 'Online Surcharge',
  minOrderAmount: null as number | null,
  maxOrderAmount: null as number | null,
  tipSuggestions: [15, 18, 20] as number[],
  defaultTip: 18,
  requireZip: false,
  allowGuestCheckout: true,
  requireContactForPickup: false,
  notificationEmail: null as string | null,
  notificationPhone: null as string | null,
  hours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    day,
    open: '11:00',
    close: '22:00',
    closed: false,
  })),
}

// GET online ordering settings for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId')

    if (!locationId) {
      return err('locationId is required')
    }

    // Auth check — require settings.venue permission
    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.SETTINGS_VENUE)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Use cached location settings instead of direct DB query (FIX-021)
    const cachedSettings = await getLocationSettings(locationId)
    const rawSettings = (cachedSettings ?? {}) as Record<string, unknown>
    const onlineOrdering = rawSettings.onlineOrdering as Record<string, unknown> | undefined

    return ok({ ...DEFAULTS, ...onlineOrdering })
  } catch (error) {
    console.error('Failed to fetch online ordering settings:', error)
    return err('Failed to fetch online ordering settings', 500)
  }
})

// PUT update online ordering settings for a location
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, employeeId, settings: incomingSettings } = body as {
      locationId: string
      employeeId?: string
      settings: { onlineOrdering?: Record<string, unknown> }
    }

    if (!locationId) {
      return err('locationId is required')
    }

    // Permission check
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_VENUE)
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

    const rawSettings = (location.settings as Record<string, unknown>) || {}
    const currentOO = (rawSettings.onlineOrdering as Record<string, unknown>) || {}
    const mergedOO = { ...DEFAULTS, ...currentOO, ...(incomingSettings.onlineOrdering || {}) }

    const updatedSettings = {
      ...rawSettings,
      onlineOrdering: mergedOO,
    }

    await db.location.update({
      where: { id: locationId },
      data: {
        settings: updatedSettings as object,
      },
    })

    invalidateLocationCache(locationId)
    void notifyDataChanged({ locationId, domain: 'settings', action: 'updated', entityId: locationId })
    void pushUpstream()

    return ok(mergedOO)
  } catch (error) {
    console.error('Failed to update online ordering settings:', error)
    return err('Failed to update online ordering settings', 500)
  }
})
