import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { dispatchQuickBarChanged } from '@/lib/socket-dispatch'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'
const log = createChildLogger('location-quick-bar-default')

// GET — returns location-level default quick bar items
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    if (!locationId) {
      return err('locationId is required')
    }

    const defaults = await db.quickBarDefault.findUnique({ where: { locationId } })

    return ok({
        itemIds: defaults ? JSON.parse(defaults.itemIds) : [],
      })
  } catch (error) {
    console.error('Failed to fetch quick bar defaults:', error)
    return err('Failed to fetch quick bar defaults', 500)
  }
})

// PUT — upsert location-level default quick bar items (manager-gated)
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, itemIds, employeeId } = body

    if (!locationId) {
      return err('locationId is required')
    }
    if (!Array.isArray(itemIds)) {
      return err('itemIds must be an array')
    }

    // Manager-gated: require settings.menu permission
    if (employeeId) {
      const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_MENU)
      if (!auth.authorized) return err(auth.error, auth.status)
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
    void dispatchQuickBarChanged(locationId).catch(err => log.warn({ err }, 'Background task failed'))

    void notifyDataChanged({ locationId, domain: 'quick-bar', action: 'updated' })
    void pushUpstream()

    return ok({ itemIds })
  } catch (error) {
    console.error('Failed to update quick bar defaults:', error)
    return err('Failed to update quick bar defaults', 500)
  }
})
