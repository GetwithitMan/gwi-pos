import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { notifyDataChanged } from '@/lib/cloud-notify'

// GET - List vendors
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const activeOnly = searchParams.get('activeOnly') !== 'false'

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const where: Record<string, unknown> = {
      locationId,
      deletedAt: null,
    }

    if (activeOnly) where.isActive = true

    const vendors = await db.vendor.findMany({
      where,
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ data: { vendors } })
  } catch (error) {
    console.error('Vendor list error:', error)
    return NextResponse.json({ error: 'Failed to fetch vendors' }, { status: 500 })
  }
})

// POST - Create vendor
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      accountNum,
      phone,
      email,
      address,
      notes,
      paymentTerms,
    } = body

    if (!locationId || !name) {
      return NextResponse.json({
        error: 'Location ID and name required',
      }, { status: 400 })
    }

    // Auth check — require inventory.vendors permission
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? body.employeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.INVENTORY_VENDORS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const vendor = await db.vendor.create({
      data: {
        locationId,
        name,
        accountNum,
        phone,
        email,
        address,
        notes,
        paymentTerms,
      },
    })

    void notifyDataChanged({ locationId, domain: 'inventory', action: 'created', entityId: vendor.id })

    return NextResponse.json({ data: { vendor } })
  } catch (error) {
    console.error('Create vendor error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Vendor with this name already exists' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to create vendor' }, { status: 500 })
  }
})
