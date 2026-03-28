import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withAuth } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

// GET - Full PO detail
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')

    if (!locationId || !employeeId) {
      return NextResponse.json({ error: 'locationId and employeeId required' }, { status: 400 })
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.INVENTORY_MANAGE)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const order = await db.vendorOrder.findFirst({
      where: { id, locationId, deletedAt: null },
      include: {
        vendor: { select: { id: true, name: true } },
        lineItems: {
          where: { deletedAt: null },
          include: {
            inventoryItem: {
              select: {
                id: true,
                name: true,
                storageUnit: true,
                purchaseUnit: true,
                unitsPerPurchase: true,
                currentStock: true,
                costPerUnit: true,
                lastInvoiceCost: true,
              },
            },
          },
        },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }

    return NextResponse.json({
      data: {
        order: {
          ...order,
          totalEstimated: order.totalEstimated ? Number(order.totalEstimated) : 0,
          totalActual: order.totalActual ? Number(order.totalActual) : 0,
          lineItems: order.lineItems.map(li => ({
            ...li,
            quantity: Number(li.quantity),
            estimatedCost: li.estimatedCost ? Number(li.estimatedCost) : null,
            actualCost: li.actualCost ? Number(li.actualCost) : null,
            receivedQty: li.receivedQty ? Number(li.receivedQty) : 0,
            inventoryItem: li.inventoryItem ? {
              ...li.inventoryItem,
              currentStock: Number(li.inventoryItem.currentStock),
              unitsPerPurchase: Number(li.inventoryItem.unitsPerPurchase),
              costPerUnit: li.inventoryItem.costPerUnit ? Number(li.inventoryItem.costPerUnit) : null,
              lastInvoiceCost: li.inventoryItem.lastInvoiceCost ? Number(li.inventoryItem.lastInvoiceCost) : null,
            } : null,
          })),
        },
      },
    })
  } catch (error) {
    console.error('Get purchase order error:', error)
    return NextResponse.json({ error: 'Failed to fetch purchase order' }, { status: 500 })
  }
})

// PUT - Edit draft PO only
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { employeeId, locationId, orderNumber, expectedDelivery, notes, lineItems } = body

    if (!locationId || !employeeId) {
      return NextResponse.json({ error: 'locationId and employeeId required' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? employeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.INVENTORY_MANAGE)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const existing = await db.vendorOrder.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }

    if (existing.status !== 'draft') {
      return NextResponse.json({ error: 'Can only edit draft purchase orders' }, { status: 400 })
    }

    const order = await db.$transaction(async (tx) => {
      // Update base order fields
      const updateData: Record<string, unknown> = {}
      if (orderNumber !== undefined) updateData.orderNumber = orderNumber
      if (expectedDelivery !== undefined) updateData.expectedDelivery = expectedDelivery ? new Date(expectedDelivery) : null
      if (notes !== undefined) updateData.notes = notes

      // Replace line items if provided
      if (lineItems) {
        // Soft delete existing line items
        await tx.vendorOrderLineItem.updateMany({
          where: { vendorOrderId: id, deletedAt: null },
          data: { deletedAt: new Date() },
        })

        // Create new line items
        if (lineItems.length > 0) {
          await tx.vendorOrderLineItem.createMany({
            data: lineItems.map((li: { inventoryItemId: string; quantity: number; unit: string; estimatedCost?: number }) => ({
              locationId,
              vendorOrderId: id,
              inventoryItemId: li.inventoryItemId,
              quantity: li.quantity,
              unit: li.unit,
              estimatedCost: li.estimatedCost ?? null,
            })),
          })
        }

        // Recalculate totalEstimated
        let totalEstimated = 0
        for (const li of lineItems) {
          if (li.estimatedCost && li.quantity) {
            totalEstimated += Number(li.quantity) * Number(li.estimatedCost)
          }
        }
        updateData.totalEstimated = totalEstimated
      }

      if (Object.keys(updateData).length > 0) {
        await tx.vendorOrder.update({
          where: { id },
          data: { ...updateData, lastMutatedBy: 'cloud' },
        })
      }

      return tx.vendorOrder.findUnique({
        where: { id },
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

    void notifyDataChanged({ locationId, domain: 'inventory', action: 'updated', entityId: id })
    pushUpstream()

    return NextResponse.json({ data: { order } })
  } catch (error) {
    console.error('Update purchase order error:', error)
    return NextResponse.json({ error: 'Failed to update purchase order' }, { status: 500 })
  }
}))

// DELETE - Soft delete (draft or cancelled only)
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')

    if (!locationId || !employeeId) {
      return NextResponse.json({ error: 'locationId and employeeId required' }, { status: 400 })
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.INVENTORY_MANAGE)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const existing = await db.vendorOrder.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }

    if (existing.status !== 'draft' && existing.status !== 'cancelled') {
      return NextResponse.json({ error: 'Can only delete draft or cancelled purchase orders' }, { status: 400 })
    }

    const now = new Date()
    await db.vendorOrder.update({
      where: { id },
      data: { deletedAt: now, lastMutatedBy: 'cloud' },
    })

    void notifyDataChanged({ locationId, domain: 'inventory', action: 'deleted', entityId: id })
    pushUpstream()

    return NextResponse.json({ data: { id, deletedAt: now } })
  } catch (error) {
    console.error('Delete purchase order error:', error)
    return NextResponse.json({ error: 'Failed to delete purchase order' }, { status: 500 })
  }
}))
