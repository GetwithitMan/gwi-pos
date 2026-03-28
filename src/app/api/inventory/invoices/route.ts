import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, ok } from '@/lib/api-response'

// GET - List invoices
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const vendorId = searchParams.get('vendorId')
    const status = searchParams.get('status')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (!locationId) {
      return err('Location ID required')
    }

    const where: Record<string, unknown> = {
      locationId,
      deletedAt: null,
    }

    if (vendorId) where.vendorId = vendorId
    if (status) where.status = status

    if (startDate || endDate) {
      where.invoiceDate = {}
      if (startDate) (where.invoiceDate as Record<string, Date>).gte = new Date(startDate)
      if (endDate) (where.invoiceDate as Record<string, Date>).lte = new Date(endDate)
    }

    const invoices = await db.invoice.findMany({
      where,
      include: {
        vendor: {
          select: { id: true, name: true },
        },
        _count: {
          select: { lineItems: true },
        },
      },
      orderBy: { invoiceDate: 'desc' },
    })

    return ok({
      invoices: invoices.map(inv => ({
        ...inv,
        totalAmount: Number(inv.totalAmount),
      })),
    })
  } catch (error) {
    console.error('Invoices list error:', error)
    return err('Failed to fetch invoices', 500)
  }
})

// POST - Create invoice with line items
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      vendorId,
      invoiceNumber,
      invoiceDate,
      dueDate,
      notes,
      lineItems,
    } = body

    if (!locationId || !vendorId || !invoiceNumber || !invoiceDate) {
      return err('Location ID, vendor, invoice number, and date required')
    }

    if (!lineItems || lineItems.length === 0) {
      return err('At least one line item required')
    }

    // Calculate totals and prepare line items
    let totalAmount = 0
    const processedItems = []

    for (const item of lineItems) {
      const quantity = Number(item.quantity)
      const unitCost = Number(item.unitCost)
      const totalCost = quantity * unitCost

      totalAmount += totalCost

      processedItems.push({
        inventoryItemId: item.inventoryItemId,
        description: item.description,
        quantity,
        unit: item.unit,
        unitCost,
        totalCost,
      })
    }

    const invoice = await db.invoice.create({
      data: {
        locationId,
        vendorId,
        invoiceNumber,
        invoiceDate: new Date(invoiceDate),
        dueDate: dueDate ? new Date(dueDate) : null,
        subtotal: totalAmount,
        totalAmount,
        status: 'pending',
        notes,
        lineItems: {
          create: processedItems.map(item => ({
            ...item,
            locationId,
          })),
        },
      },
      include: {
        vendor: {
          select: { id: true, name: true },
        },
        lineItems: {
          include: {
            inventoryItem: {
              select: { id: true, name: true, sku: true },
            },
          },
        },
      },
    })

    void notifyDataChanged({ locationId, domain: 'inventory', action: 'created', entityId: invoice.id })
    pushUpstream()

    return ok({
      invoice: {
        ...invoice,
        totalAmount: Number(invoice.totalAmount),
        lineItems: invoice.lineItems.map((li: { quantity: unknown; unitCost: unknown; totalCost: unknown }) => ({
          ...li,
          quantity: Number(li.quantity),
          unitCost: Number(li.unitCost),
          totalCost: Number(li.totalCost),
        })),
      },
    })
  } catch (error) {
    console.error('Create invoice error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return err('Invoice with this number already exists')
    }
    return err('Failed to create invoice', 500)
  }
}))
