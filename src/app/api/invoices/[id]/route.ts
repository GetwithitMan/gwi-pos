import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

// GET /api/invoices/[id] — get invoice with line items
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.INVENTORY_VIEW)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const invoice = await db.invoice.findFirst({
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
                purchaseUnit: true,
                storageUnit: true,
                purchaseCost: true,
                costPerUnit: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    return NextResponse.json({
      data: {
        invoice: {
          ...invoice,
          subtotal: Number(invoice.subtotal),
          taxAmount: Number(invoice.taxAmount),
          shippingCost: Number(invoice.shippingCost),
          totalAmount: Number(invoice.totalAmount),
          lineItems: invoice.lineItems.map(li => ({
            ...li,
            quantity: Number(li.quantity),
            unitCost: Number(li.unitCost),
            totalCost: Number(li.totalCost),
            previousCost: li.previousCost ? Number(li.previousCost) : null,
            costChange: li.costChange ? Number(li.costChange) : null,
            costChangePct: li.costChangePct ? Number(li.costChangePct) : null,
            inventoryItem: li.inventoryItem ? {
              ...li.inventoryItem,
              purchaseCost: Number(li.inventoryItem.purchaseCost),
              costPerUnit: Number(li.inventoryItem.costPerUnit),
            } : null,
          })),
        },
      },
    })
  } catch (error) {
    console.error('Get invoice error:', error)
    return NextResponse.json({ error: 'Failed to fetch invoice' }, { status: 500 })
  }
})

// PATCH /api/invoices/[id] — update draft invoice
export const PATCH = withVenue(async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, requestingEmployeeId, ...updates } = body

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.INVENTORY_MANAGE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Only allow editing draft invoices
    const existing = await db.invoice.findFirst({
      where: { id, locationId, deletedAt: null },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }
    if (String(existing.status) !== 'draft') {
      return NextResponse.json({ error: 'Only draft invoices can be edited' }, { status: 400 })
    }

    const allowedFields: Record<string, unknown> = {}
    if (updates.invoiceNumber !== undefined) allowedFields.invoiceNumber = updates.invoiceNumber
    if (updates.invoiceDate !== undefined) allowedFields.invoiceDate = new Date(updates.invoiceDate)
    if (updates.deliveryDate !== undefined) allowedFields.deliveryDate = updates.deliveryDate ? new Date(updates.deliveryDate) : null
    if (updates.notes !== undefined) allowedFields.notes = updates.notes || null
    if (updates.vendorId !== undefined) allowedFields.vendorId = updates.vendorId

    const invoice = await db.invoice.update({
      where: { id },
      data: allowedFields,
      include: {
        vendor: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({
      data: {
        invoice: {
          ...invoice,
          subtotal: Number(invoice.subtotal),
          taxAmount: Number(invoice.taxAmount),
          shippingCost: Number(invoice.shippingCost),
          totalAmount: Number(invoice.totalAmount),
        },
      },
    })
  } catch (error) {
    console.error('Update invoice error:', error)
    return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 })
  }
})

// DELETE /api/invoices/[id] — soft delete (draft only)
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.INVENTORY_MANAGE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const existing = await db.invoice.findFirst({
      where: { id, locationId, deletedAt: null },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }
    if (String(existing.status) !== 'draft') {
      return NextResponse.json({ error: 'Only draft invoices can be deleted' }, { status: 400 })
    }

    await db.invoice.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Delete invoice error:', error)
    return NextResponse.json({ error: 'Failed to delete invoice' }, { status: 500 })
  }
})
