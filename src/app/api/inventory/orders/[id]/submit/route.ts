import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withAuth } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

// POST - Submit PO: draft → sent
export const POST = withVenue(withAuth('ADMIN', async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { employeeId, locationId } = body

    if (!locationId || !employeeId) {
      return err('locationId and employeeId required')
    }

    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? employeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.INVENTORY_MANAGE)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    const order = await db.vendorOrder.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!order) {
      return notFound('Purchase order not found')
    }

    if (order.status !== 'draft') {
      return err('Can only submit draft purchase orders')
    }

    await db.vendorOrder.update({
      where: { id },
      data: { status: 'sent', lastMutatedBy: 'cloud' },
    })

    void notifyDataChanged({ locationId, domain: 'inventory', action: 'updated', entityId: id })
    pushUpstream()

    return ok({ id, status: 'sent' })
  } catch (error) {
    console.error('Submit purchase order error:', error)
    return err('Failed to submit purchase order', 500)
  }
}))
