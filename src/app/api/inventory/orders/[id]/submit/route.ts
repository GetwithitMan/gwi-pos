import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

// POST - Submit PO: draft → sent
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { employeeId, locationId } = body

    if (!locationId || !employeeId) {
      return NextResponse.json({ error: 'locationId and employeeId required' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? employeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.INVENTORY_MANAGE)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const order = await db.vendorOrder.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!order) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }

    if (order.status !== 'draft') {
      return NextResponse.json({ error: 'Can only submit draft purchase orders' }, { status: 400 })
    }

    await db.vendorOrder.update({
      where: { id },
      data: { status: 'sent' },
    })

    return NextResponse.json({ data: { id, status: 'sent' } })
  } catch (error) {
    console.error('Submit purchase order error:', error)
    return NextResponse.json({ error: 'Failed to submit purchase order' }, { status: 500 })
  }
})
