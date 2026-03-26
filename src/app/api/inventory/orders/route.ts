import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withAuth } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

// GET - List purchase orders
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')
    const status = searchParams.get('status')
    const vendorId = searchParams.get('vendorId')
    const limit = parseInt(searchParams.get('limit') ?? '50', 10)

    if (!locationId || !employeeId) {
      return NextResponse.json({ error: 'locationId and employeeId required' }, { status: 400 })
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.INVENTORY_MANAGE)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const cappedLimit = Math.min(Math.max(limit, 1), 200)

    const where: Record<string, unknown> = {
      locationId,
      deletedAt: null,
    }
    if (status) where.status = status
    if (vendorId) where.vendorId = vendorId

    const [orders, total] = await Promise.all([
      db.vendorOrder.findMany({
        where,
        include: {
          vendor: { select: { id: true, name: true } },
          _count: { select: { lineItems: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: cappedLimit,
      }),
      db.vendorOrder.count({ where }),
    ])

    return NextResponse.json({
      data: {
        orders: orders.map(o => ({
          id: o.id,
          vendorId: o.vendorId,
          vendorName: o.vendor?.name ?? null,
          orderNumber: o.orderNumber,
          status: o.status,
          orderDate: o.orderDate,
          expectedDelivery: o.expectedDelivery,
          receivedAt: o.receivedAt,
          totalEstimated: o.totalEstimated ? Number(o.totalEstimated) : 0,
          totalActual: o.totalActual ? Number(o.totalActual) : 0,
          notes: o.notes,
          createdById: o.createdById,
          lineItemCount: o._count.lineItems,
          createdAt: o.createdAt,
          updatedAt: o.updatedAt,
        })),
        total,
      },
    })
  } catch (error) {
    console.error('List purchase orders error:', error)
    return NextResponse.json({ error: 'Failed to fetch purchase orders' }, { status: 500 })
  }
})

// POST - Create new purchase order (draft)
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, employeeId, vendorId, orderNumber, expectedDelivery, notes, lineItems } = body

    if (!locationId || !employeeId || !vendorId) {
      return NextResponse.json({ error: 'locationId, employeeId, and vendorId required' }, { status: 400 })
    }

    if (!lineItems?.length) {
      return NextResponse.json({ error: 'lineItems array required and must not be empty' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? employeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.INVENTORY_MANAGE)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Validate vendor exists for this location
    const vendor = await db.vendor.findFirst({
      where: { id: vendorId, locationId, deletedAt: null },
    })
    if (!vendor) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }

    // Validate inventory items exist
    if (lineItems?.length) {
      const itemIds = lineItems.map((li: { inventoryItemId: string }) => li.inventoryItemId)
      const items = await db.inventoryItem.findMany({
        where: { id: { in: itemIds }, locationId, deletedAt: null },
        select: { id: true },
      })
      const foundIds = new Set(items.map(i => i.id))
      const missing = itemIds.filter((id: string) => !foundIds.has(id))
      if (missing.length > 0) {
        return NextResponse.json({ error: `Inventory items not found: ${missing.join(', ')}` }, { status: 400 })
      }
    }

    // Calculate totalEstimated
    let totalEstimated = 0
    if (lineItems?.length) {
      for (const li of lineItems) {
        if (li.estimatedCost && li.quantity) {
          totalEstimated += Number(li.quantity) * Number(li.estimatedCost)
        }
      }
    }

    const order = await db.$transaction(async (tx) => {
      const created = await tx.vendorOrder.create({
        data: {
          locationId,
          vendorId,
          orderNumber: orderNumber || `PO-${Date.now().toString(36).toUpperCase()}`,
          expectedDelivery: expectedDelivery ? new Date(expectedDelivery) : null,
          notes: notes ?? null,
          totalEstimated,
          createdById: employeeId,
        },
      })

      if (lineItems?.length) {
        await tx.vendorOrderLineItem.createMany({
          data: lineItems.map((li: { inventoryItemId: string; quantity: number; unit: string; estimatedCost?: number }) => ({
            locationId,
            vendorOrderId: created.id,
            inventoryItemId: li.inventoryItemId,
            quantity: li.quantity,
            unit: li.unit,
            estimatedCost: li.estimatedCost ?? null,
          })),
        })
      }

      return tx.vendorOrder.findUnique({
        where: { id: created.id },
        include: {
          vendor: { select: { id: true, name: true } },
          lineItems: {
            where: { deletedAt: null },
            include: {
              inventoryItem: {
                select: { id: true, name: true, storageUnit: true, currentStock: true, purchaseUnit: true, unitsPerPurchase: true },
              },
            },
          },
        },
      })
    })

    void notifyDataChanged({ locationId, domain: 'inventory', action: 'created', entityId: order?.id ?? '' })
    pushUpstream()

    return NextResponse.json({ data: { order } })
  } catch (error) {
    console.error('Create purchase order error:', error)
    return NextResponse.json({ error: 'Failed to create purchase order' }, { status: 500 })
  }
}))
