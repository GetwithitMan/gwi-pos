import { NextRequest, NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { db } from '@/lib/db'

export const POST = withVenue(async function POST(request: NextRequest) {
  const location = await db.location.findFirst({ select: { id: true } })
  if (!location) return NextResponse.json({ error: 'No location' }, { status: 404 })

  const body = await request.json().catch(() => ({})) as {
    employeeId?: string
    marginEdgeProductId?: string
    marginEdgeProductName?: string
    inventoryItemId?: string
    marginEdgeVendorId?: string
    marginEdgeVendorName?: string
    marginEdgeUnit?: string
  }

  const actor = await getActorFromRequest(request)
  const resolvedEmployeeId = actor.employeeId ?? body.employeeId
  const auth = await requirePermission(resolvedEmployeeId, location.id, PERMISSIONS.SETTINGS_EDIT)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  if (!body.marginEdgeProductId || !body.marginEdgeProductName || !body.inventoryItemId) {
    return NextResponse.json({ error: 'marginEdgeProductId, marginEdgeProductName, and inventoryItemId are required' }, { status: 400 })
  }

  // Verify inventory item exists
  const item = await db.inventoryItem.findFirst({
    where: { id: body.inventoryItemId, locationId: location.id, deletedAt: null },
  })
  if (!item) {
    return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 })
  }

  const mapping = await db.marginEdgeProductMapping.upsert({
    where: {
      locationId_marginEdgeProductId: {
        locationId: location.id,
        marginEdgeProductId: body.marginEdgeProductId,
      },
    },
    create: {
      locationId: location.id,
      marginEdgeProductId: body.marginEdgeProductId,
      marginEdgeProductName: body.marginEdgeProductName,
      inventoryItemId: body.inventoryItemId,
      marginEdgeVendorId: body.marginEdgeVendorId ?? null,
      marginEdgeVendorName: body.marginEdgeVendorName ?? null,
      marginEdgeUnit: body.marginEdgeUnit ?? null,
      lastSyncAt: new Date(),
      isActive: true,
    },
    update: {
      marginEdgeProductName: body.marginEdgeProductName,
      inventoryItemId: body.inventoryItemId,
      marginEdgeVendorId: body.marginEdgeVendorId ?? null,
      marginEdgeVendorName: body.marginEdgeVendorName ?? null,
      marginEdgeUnit: body.marginEdgeUnit ?? null,
      lastSyncAt: new Date(),
      isActive: true,
    },
  })

  return NextResponse.json({ data: mapping })
})
