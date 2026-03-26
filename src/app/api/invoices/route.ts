import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { notifyDataChanged } from '@/lib/cloud-notify'

// GET /api/invoices — list invoices with filters
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId')
    const vendorId = searchParams.get('vendorId')
    const status = searchParams.get('status')
    const source = searchParams.get('source')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.INVENTORY_VIEW)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const where: Record<string, unknown> = {
      locationId,
      deletedAt: null,
    }
    if (vendorId) where.vendorId = vendorId
    if (status) where.status = status
    if (source) where.source = source
    if (startDate || endDate) {
      where.invoiceDate = {
        ...(startDate ? { gte: new Date(startDate) } : {}),
        ...(endDate ? { lte: new Date(endDate + 'T23:59:59Z') } : {}),
      }
    }

    const [invoices, total] = await Promise.all([
      db.invoice.findMany({
        where,
        include: {
          vendor: { select: { id: true, name: true } },
          _count: { select: { lineItems: true } },
        },
        orderBy: { invoiceDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.invoice.count({ where }),
    ])

    return NextResponse.json({
      data: {
        // NOTE: deliveryDate, source, marginEdgeInvoiceId fields resolve after prisma generate
        invoices: invoices.map((inv: any) => ({
          id: inv.id,
          vendorId: inv.vendorId,
          vendorName: inv.vendor.name,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate,
          deliveryDate: inv.deliveryDate,
          subtotal: Number(inv.subtotal),
          taxAmount: Number(inv.taxAmount),
          shippingCost: Number(inv.shippingCost),
          totalAmount: Number(inv.totalAmount),
          status: inv.status,
          source: inv.source,
          marginEdgeInvoiceId: inv.marginEdgeInvoiceId,
          updateCosts: inv.updateCosts,
          addToInventory: inv.addToInventory,
          notes: inv.notes,
          lineItemCount: inv._count.lineItems,
          createdAt: inv.createdAt,
        })),
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Invoice list error:', error)
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 })
  }
})

// POST /api/invoices — create invoice (status: draft)
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      requestingEmployeeId,
      vendorId,
      invoiceNumber,
      invoiceDate,
      deliveryDate,
      notes,
      lineItems = [],
    } = body

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.INVENTORY_MANAGE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    if (!invoiceDate) {
      return NextResponse.json({ error: 'invoiceDate is required' }, { status: 400 })
    }

    // Calculate totals from line items
    let subtotal = 0
    const processedLineItems: Array<{
      locationId: string
      inventoryItemId: string | null
      description: string | null
      quantity: number
      unit: string
      unitCost: number
      totalCost: number
      previousCost: number | null
      costChange: number | null
      costChangePct: number | null
    }> = []

    for (const item of lineItems) {
      const qty = Number(item.quantity) || 0
      const cost = Number(item.unitCost) || 0
      const lineTotalCost = qty * cost
      subtotal += lineTotalCost

      let previousCost: number | null = null
      let costChange: number | null = null
      let costChangePct: number | null = null

      // If linked to inventory item, calculate cost change
      if (item.inventoryItemId) {
        const invItem = await db.inventoryItem.findFirst({
          where: { id: item.inventoryItemId, locationId, deletedAt: null },
          select: { purchaseCost: true },
        })
        if (invItem) {
          previousCost = Number(invItem.purchaseCost)
          costChange = cost - previousCost
          costChangePct = previousCost > 0
            ? ((cost - previousCost) / previousCost) * 100
            : null
        }
      }

      processedLineItems.push({
        locationId,
        inventoryItemId: item.inventoryItemId || null,
        description: item.description || null,
        quantity: qty,
        unit: item.unit || 'each',
        unitCost: cost,
        totalCost: lineTotalCost,
        previousCost,
        costChange,
        costChangePct,
      })
    }

    const invoice = await db.invoice.create({
      data: {
        locationId,
        vendorId: vendorId || undefined,
        invoiceNumber: invoiceNumber || '',
        invoiceDate: new Date(invoiceDate),
        deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
        subtotal,
        totalAmount: subtotal,
        status: 'draft' as never, // enum cast — resolves after prisma generate
        source: 'manual' as never, // enum cast — resolves after prisma generate
        notes: notes || null,
        enteredById: requestingEmployeeId || null,
        createdById: requestingEmployeeId || null,
        lineItems: {
          create: processedLineItems,
        },
      },
      include: {
        vendor: { select: { id: true, name: true } },
        lineItems: {
          include: {
            inventoryItem: { select: { id: true, name: true, purchaseUnit: true, storageUnit: true } },
          },
        },
      },
    })

    // Sync upstream
    void notifyDataChanged({ locationId, domain: 'invoices', action: 'created' })
    void pushUpstream()

    return NextResponse.json({
      data: {
        invoice: {
          ...invoice,
          subtotal: Number(invoice.subtotal),
          taxAmount: Number(invoice.taxAmount),
          shippingCost: Number(invoice.shippingCost),
          totalAmount: Number(invoice.totalAmount),
          lineItems: (invoice as any).lineItems.map((li: any) => ({
            ...li,
            quantity: Number(li.quantity),
            unitCost: Number(li.unitCost),
            totalCost: Number(li.totalCost),
            previousCost: li.previousCost ? Number(li.previousCost) : null,
            costChange: li.costChange ? Number(li.costChange) : null,
            costChangePct: li.costChangePct ? Number(li.costChangePct) : null,
          })),
        },
      },
    })
  } catch (error) {
    console.error('Create invoice error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Failed to create invoice', detail: message }, { status: 500 })
  }
})
