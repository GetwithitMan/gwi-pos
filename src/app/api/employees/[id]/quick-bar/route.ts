import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getRequestLocationId } from '@/lib/request-context'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'

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
        return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
      }
      qbLocationId = employee.locationId
    }

    const [pref, defaults] = await Promise.all([
      db.quickBarPreference.findUnique({ where: { employeeId } }),
      db.quickBarDefault.findUnique({ where: { locationId: qbLocationId } }),
    ])

    return NextResponse.json({
      data: {
        itemIds: pref ? JSON.parse(pref.itemIds) : [],
        defaultItemIds: defaults ? JSON.parse(defaults.itemIds) : [],
      },
    })
  } catch (error) {
    console.error('Failed to fetch quick bar preferences:', error)
    return NextResponse.json({ error: 'Failed to fetch quick bar preferences' }, { status: 500 })
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
      return NextResponse.json({ error: 'itemIds must be an array' }, { status: 400 })
    }

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let putLocationId = getRequestLocationId()
    if (!putLocationId) {
      const employee = await db.employee.findUnique({
        where: { id: employeeId },
        select: { locationId: true },
      })
      if (!employee) {
        return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
      }
      putLocationId = employee.locationId
    }

    // Auth check — require POS access and verify employee is editing their own record
    const actor = await getActorFromRequest(request)
    const resolvedActorId = actor.employeeId ?? employeeId
    const auth = await requirePermission(resolvedActorId, putLocationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })
    if (auth.employee.id !== employeeId) {
      return NextResponse.json({ error: 'You can only edit your own quick bar' }, { status: 403 })
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

    return NextResponse.json({ data: { itemIds } })
  } catch (error) {
    console.error('Failed to update quick bar preferences:', error)
    return NextResponse.json({ error: 'Failed to update quick bar preferences' }, { status: 500 })
  }
})
