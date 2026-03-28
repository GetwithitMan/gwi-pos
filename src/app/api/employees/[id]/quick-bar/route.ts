import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getRequestLocationId } from '@/lib/request-context'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, forbidden, notFound, ok } from '@/lib/api-response'

// GET — returns employee's quick bar items and location defaults
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: employeeId } = await params

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let qbLocationId = getRequestLocationId()
    if (!qbLocationId) {
      const employee = await db.employee.findUnique({
        where: { id: employeeId },
        select: { locationId: true },
      })
      if (!employee) {
        return notFound('Employee not found')
      }
      qbLocationId = employee.locationId
    }

    const [pref, defaults] = await Promise.all([
      db.quickBarPreference.findUnique({ where: { employeeId } }),
      db.quickBarDefault.findUnique({ where: { locationId: qbLocationId } }),
    ])

    return ok({
        itemIds: pref ? JSON.parse(pref.itemIds) : [],
        defaultItemIds: defaults ? JSON.parse(defaults.itemIds) : [],
      })
  } catch (error) {
    console.error('Failed to fetch quick bar preferences:', error)
    return err('Failed to fetch quick bar preferences', 500)
  }
})

// PUT — upsert employee's quick bar items
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: employeeId } = await params
    const body = await request.json()
    const { itemIds } = body

    if (!Array.isArray(itemIds)) {
      return err('itemIds must be an array')
    }

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let putLocationId = getRequestLocationId()
    if (!putLocationId) {
      const employee = await db.employee.findUnique({
        where: { id: employeeId },
        select: { locationId: true },
      })
      if (!employee) {
        return notFound('Employee not found')
      }
      putLocationId = employee.locationId
    }

    // Auth check — require POS access and verify employee is editing their own record
    const actor = await getActorFromRequest(request)
    const resolvedActorId = actor.employeeId ?? employeeId
    const auth = await requirePermission(resolvedActorId, putLocationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return err(auth.error, auth.status)
    if (auth.employee.id !== employeeId) {
      return forbidden('You can only edit your own quick bar')
    }

    await db.quickBarPreference.upsert({
      where: { employeeId },
      create: {
        locationId: putLocationId,
        employeeId,
        itemIds: JSON.stringify(itemIds),
      },
      update: {
        itemIds: JSON.stringify(itemIds),
      },
    })

    void notifyDataChanged({ locationId: putLocationId, domain: 'quick-bar', action: 'updated', entityId: employeeId })
    void pushUpstream()

    return ok({ itemIds })
  } catch (error) {
    console.error('Failed to update quick bar preferences:', error)
    return err('Failed to update quick bar preferences', 500)
  }
})
