import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth, type AuthenticatedContext } from '@/lib/api-auth-middleware'
import { emitToLocation } from '@/lib/socket-server'
import { err, notFound, ok } from '@/lib/api-response'

const BILLING_SOURCE = 'api' as never

function serializeInvoice(inv: any) {
  // Parse payment history from notes field
  let notes = inv.notes || ''
  let paymentHistory: any[] = []
  const paymentMarker = '\n---PAYMENTS---\n'
  if (notes.includes(paymentMarker)) {
    const parts = notes.split(paymentMarker)
    notes = parts[0]
    try {
      paymentHistory = JSON.parse(parts[1])
    } catch { /* ignore parse errors */ }
  }

  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    status: String(inv.status),
    customerName: inv.vendor?.name ?? '',
    customerEmail: inv.vendor?.email ?? '',
    customerPhone: inv.vendor?.phone ?? '',
    customerAddress: inv.vendor?.address ?? '',
    customerId: inv.vendorId,
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate,
    sentAt: inv.deliveryDate,
    paidDate: inv.paidDate,
    subtotal: Number(inv.subtotal),
    taxAmount: Number(inv.taxAmount),
    total: Number(inv.totalAmount),
    amountPaid: Number(inv.shippingCost),
    balanceDue: Number(inv.totalAmount) - Number(inv.shippingCost),
    notes,
    paymentHistory,
    lineItems: inv.lineItems?.map((li: any) => ({
      id: li.id,
      description: li.description,
      quantity: Number(li.quantity),
      unitPrice: Number(li.unitCost),
      total: Number(li.totalCost),
      taxable: li.unit === 'taxable',
    })) ?? [],
    createdAt: inv.createdAt,
    updatedAt: inv.updatedAt,
    enteredById: inv.enteredById,
    approvedById: inv.approvedById,
    approvedAt: inv.approvedAt,
  }
}

// ─── GET /api/billing-invoices/[id] ─────────────────────────────────────────
// Get invoice detail with line items and payment history
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = request.nextUrl.searchParams.get('locationId')
    if (!locationId) {
      return err('locationId is required')
    }

    const invoice = await db.invoice.findFirst({
      where: { id, locationId, deletedAt: null, source: BILLING_SOURCE },
      include: {
        vendor: { select: { id: true, name: true, email: true, phone: true, address: true } },
        lineItems: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!invoice) {
      return notFound('Invoice not found')
    }

    return ok(serializeInvoice(invoice))
  } catch (error) {
    console.error('Get billing invoice error:', error)
    return err('Failed to fetch invoice', 500)
  }
})

// ─── PUT /api/billing-invoices/[id] ─────────────────────────────────────────
// Update invoice (only if draft)
export const PUT = withVenue(withAuth('INVENTORY_MANAGE', async function PUT(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const { id } = await (ctx as any).params
    const locationId = ctx.auth.locationId
    const body = await request.json()

    const existing = await db.invoice.findFirst({
      where: { id, locationId, deletedAt: null, source: BILLING_SOURCE },
      include: { lineItems: { where: { deletedAt: null } } },
    })

    if (!existing) {
      return notFound('Invoice not found')
    }
    if (String(existing.status) !== 'draft') {
      return err('Only draft invoices can be edited')
    }

    const {
      customerName,
      customerEmail,
      customerAddress,
      lineItems,
      notes,
      dueDate,
      paymentTermsDays,
    } = body

    // Update vendor/customer info if provided
    if (customerName || customerEmail || customerAddress) {
      await db.vendor.update({
        where: { id: existing.vendorId },
        data: {
          ...(customerName ? { name: customerName } : {}),
          ...(customerEmail !== undefined ? { email: customerEmail || null } : {}),
          ...(customerAddress !== undefined ? { address: customerAddress || null } : {}),
        },
      })
    }

    // If line items provided, replace all
    const updateData: Record<string, unknown> = {}
    if (notes !== undefined) updateData.notes = notes || null

    if (dueDate) {
      updateData.dueDate = new Date(dueDate)
    } else if (paymentTermsDays) {
      updateData.dueDate = new Date(
        new Date(existing.invoiceDate).getTime() + paymentTermsDays * 24 * 60 * 60 * 1000
      )
    }

    if (lineItems && Array.isArray(lineItems)) {
      // Soft delete existing line items
      await db.invoiceLineItem.updateMany({
        where: { invoiceId: id, locationId },
        data: { deletedAt: new Date() },
      })

      // Recalculate totals
      let subtotal = 0
      const newLineItems: Array<{
        locationId: string
        description: string | null
        quantity: number
        unit: string
        unitCost: number
        totalCost: number
      }> = []

      for (const item of lineItems) {
        const qty = Number(item.quantity) || 0
        const price = Number(item.unitPrice) || 0
        const lineTotal = qty * price
        subtotal += lineTotal

        newLineItems.push({
          locationId,
          description: item.description || null,
          quantity: qty,
          unit: item.taxable !== false ? 'taxable' : 'nontaxable',
          unitCost: price,
          totalCost: lineTotal,
        })
      }

      // Get tax settings
      const location = await db.location.findFirst({
        where: { id: locationId },
        select: { settings: true },
      })
      const settings = (location?.settings as any) || {}
      const taxRate = settings.invoicing?.defaultTaxRate || 0

      const taxableSubtotal = newLineItems
        .filter(li => li.unit === 'taxable')
        .reduce((sum, li) => sum + li.totalCost, 0)
      // Invoice billing uses exclusive tax only — not affected by tax-inclusive menu pricing
      const taxAmount = taxRate > 0 ? (taxableSubtotal * taxRate) / 100 : 0
      const totalAmount = subtotal + taxAmount

      updateData.subtotal = subtotal
      updateData.taxAmount = taxAmount
      updateData.totalAmount = totalAmount
      updateData.lineItems = { create: newLineItems }
    }

    const invoice = await db.invoice.update({
      where: { id },
      data: updateData as any,
      include: {
        vendor: { select: { id: true, name: true, email: true, phone: true, address: true } },
        lineItems: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    void emitToLocation(locationId, 'invoices:changed', { locationId }).catch(console.error)

    return ok(serializeInvoice(invoice))
  } catch (error) {
    console.error('Update billing invoice error:', error)
    return err('Failed to update invoice', 500)
  }
}))

// ─── DELETE /api/billing-invoices/[id] ──────────────────────────────────────
// Void invoice (soft delete, only if not paid)
export const DELETE = withVenue(withAuth('INVENTORY_MANAGE', async function DELETE(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const { id } = await (ctx as any).params
    const locationId = ctx.auth.locationId

    const existing = await db.invoice.findFirst({
      where: { id, locationId, deletedAt: null, source: BILLING_SOURCE },
    })

    if (!existing) {
      return notFound('Invoice not found')
    }

    const status = String(existing.status)
    if (status === 'paid') {
      return err('Cannot void a paid invoice')
    }

    // Void the invoice (set status to voided)
    await db.invoice.update({
      where: { id },
      data: { status: 'voided' as never },
    })

    void emitToLocation(locationId, 'invoices:changed', { locationId }).catch(console.error)

    return ok({ success: true })
  } catch (error) {
    console.error('Void billing invoice error:', error)
    return err('Failed to void invoice', 500)
  }
}))
