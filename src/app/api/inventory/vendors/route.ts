import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, ok } from '@/lib/api-response'

// GET - List vendors
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const activeOnly = searchParams.get('activeOnly') !== 'false'

    if (!locationId) {
      return err('Location ID required')
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

    return ok({ vendors })
  } catch (error) {
    console.error('Vendor list error:', error)
    return err('Failed to fetch vendors', 500)
  }
})

// POST - Create vendor
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
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
      return err('Location ID and name required')
    }

    // Auth check — require inventory.vendors permission
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? body.employeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.INVENTORY_VENDORS)
    if (!auth.authorized) return err(auth.error, auth.status)

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
    void pushUpstream()

    return ok({ vendor })
  } catch (error) {
    console.error('Create vendor error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return err('Vendor with this name already exists')
    }
    return err('Failed to create vendor', 500)
  }
}))
