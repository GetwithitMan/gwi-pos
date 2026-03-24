import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getLocationSettings, invalidateLocationCache } from '@/lib/location-cache'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { withVenue } from '@/lib/with-venue'
import { DEFAULT_VENUE_PORTAL } from '@/lib/settings/defaults'

// GET site config (venuePortal) for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.SETTINGS_VENUE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const cachedSettings = await getLocationSettings(locationId)
    const rawSettings = (cachedSettings ?? {}) as Record<string, unknown>
    const venuePortal = rawSettings.venuePortal as Record<string, unknown> | undefined

    return NextResponse.json({ data: { ...DEFAULT_VENUE_PORTAL, ...venuePortal } })
  } catch (error) {
    console.error('Failed to fetch site config:', error)
    return NextResponse.json(
      { error: 'Failed to fetch site config' },
      { status: 500 }
    )
  }
})

// PUT update site config (venuePortal) for a location
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, employeeId, settings: incomingSettings } = body as {
      locationId: string
      employeeId?: string
      settings: Record<string, unknown>
    }

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

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
    const currentVP = (rawSettings.venuePortal as Record<string, unknown>) || {}
    const mergedVP = { ...DEFAULT_VENUE_PORTAL, ...currentVP, ...incomingSettings }

    const updatedSettings = {
      ...rawSettings,
      venuePortal: mergedVP,
    }

    await db.location.update({
      where: { id: locationId },
      data: {
        settings: updatedSettings as object,
      },
    })

    invalidateLocationCache(locationId)
    void notifyDataChanged({ locationId, domain: 'settings', action: 'updated', entityId: locationId })

    return NextResponse.json({ data: mergedVP })
  } catch (error) {
    console.error('Failed to update site config:', error)
    return NextResponse.json(
      { error: 'Failed to update site config' },
      { status: 500 }
    )
  }
})
