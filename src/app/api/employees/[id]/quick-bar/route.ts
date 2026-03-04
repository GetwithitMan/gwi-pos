import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET — returns employee's quick bar items and location defaults
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: employeeId } = await params

    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      select: { locationId: true },
    })
    if (!employee) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    }

    const [pref, defaults] = await Promise.all([
      db.quickBarPreference.findUnique({ where: { employeeId } }),
      db.quickBarDefault.findUnique({ where: { locationId: employee.locationId } }),
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

    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      select: { locationId: true },
    })
    if (!employee) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    }

    await db.quickBarPreference.upsert({
      where: { employeeId },
      create: {
        locationId: employee.locationId,
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
