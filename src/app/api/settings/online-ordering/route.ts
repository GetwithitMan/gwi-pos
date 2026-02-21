import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { invalidateLocationCache } from '@/lib/location-cache'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { withVenue } from '@/lib/with-venue'

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

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { id: true, settings: true },
    })

    if (!location) {
      return NextResponse.json(
        { error: 'Location not found' },
        { status: 404 }
      )
    }

    const rawSettings = (location.settings ?? {}) as Record<string, unknown>
    const onlineOrdering = rawSettings.onlineOrdering as Record<string, unknown> | undefined

    return NextResponse.json({ data: { ...DEFAULTS, ...onlineOrdering } })
  } catch (error) {
    console.error('Failed to fetch online ordering settings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch online ordering settings' },
      { status: 500 }
    )
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
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // Permission check
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_VENUE)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { id: true, settings: true },
    })

    if (!location) {
      return NextResponse.json(
        { error: 'Location not found' },
        { status: 404 }
      )
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

    return NextResponse.json({ data: mergedOO })
  } catch (error) {
    console.error('Failed to update online ordering settings:', error)
    return NextResponse.json(
      { error: 'Failed to update online ordering settings' },
      { status: 500 }
    )
  }
})
