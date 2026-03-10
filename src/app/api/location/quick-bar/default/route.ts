import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { dispatchQuickBarChanged } from '@/lib/socket-dispatch'

// GET — returns location-level default quick bar items
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const defaults = await db.quickBarDefault.findUnique({ where: { locationId } })

    return NextResponse.json({
      data: {
        itemIds: defaults ? JSON.parse(defaults.itemIds) : [],
      },
    })
  } catch (error) {
    console.error('Failed to fetch quick bar defaults:', error)
    return NextResponse.json({ error: 'Failed to fetch quick bar defaults' }, { status: 500 })
  }
})

// PUT — upsert location-level default quick bar items (manager-gated)
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, itemIds, employeeId } = body

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }
    if (!Array.isArray(itemIds)) {
      return NextResponse.json({ error: 'itemIds must be an array' }, { status: 400 })
    }

    // Manager-gated: require settings.menu permission
    if (employeeId) {
      const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_MENU)
      if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    await db.quickBarDefault.upsert({
      where: { locationId },
      create: {
        locationId,
        itemIds: JSON.stringify(itemIds),
      },
      update: {
        itemIds: JSON.stringify(itemIds),
      },
    })

    // Notify all terminals to refresh quick bar
    void dispatchQuickBarChanged(locationId).catch(console.error)

    return NextResponse.json({ data: { itemIds } })
  } catch (error) {
    console.error('Failed to update quick bar defaults:', error)
    return NextResponse.json({ error: 'Failed to update quick bar defaults' }, { status: 500 })
  }
})
