import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth, type AuthenticatedContext } from '@/lib/api-auth-middleware'
import { mergeWithDefaults, DEFAULT_INVOICING } from '@/lib/settings'

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Get invoicing settings for a location, merged with defaults. */
async function getInvoicingSettings(locationId: string) {
  const location = await db.location.findFirst({
    where: { id: locationId },
    select: { settings: true },
  })
  const settings = mergeWithDefaults(location?.settings as any)
  return settings.invoicing ?? DEFAULT_INVOICING
}

/** Generate the next auto-incremented invoice number and bump the counter atomically. */
async function generateInvoiceNumber(locationId: string): Promise<string> {
  const invSettings = await getInvoicingSettings(locationId)
  const prefix = invSettings.autoNumberPrefix || 'INV'
  const defaultStart = invSettings.nextInvoiceNumber || 1001

  // Atomic increment: UPDATE ... RETURNING prevents two concurrent requests
  // from reading the same nextInvoiceNumber.
  const rows = await db.$queryRawUnsafe<{ next: number }[]>(
    `UPDATE "Location"
     SET settings = jsonb_set(
       COALESCE(settings, '{}'),
       '{invoicing,nextInvoiceNumber}',
       to_jsonb(COALESCE((settings->'invoicing'->>'nextInvoiceNumber')::int, $2) + 1)
     )
     WHERE id = $1
     RETURNING COALESCE((settings->'invoicing'->>'nextInvoiceNumber')::int, $2 + 1) - 1 AS next`,
    locationId,
    defaultStart
  )

  const nextNum = rows[0]?.next ?? defaultStart

  return `${prefix}-${String(nextNum).padStart(5, '0')}`
}

/**
 * Determine if an invoice is a billing invoice (source = 'api').
 * All billing invoices use source='api' to distinguish from vendor/inventory invoices.
 */
const BILLING_SOURCE = 'api' as never // InvoiceSource enum — cast for prisma

/**
 * Serialize Decimal fields to numbers for JSON response.
 */
function serializeInvoice(inv: any) {
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
    sentAt: inv.deliveryDate, // deliveryDate repurposed as sentAt for billing invoices
    paidDate: inv.paidDate,
    subtotal: Number(inv.subtotal),
    taxAmount: Number(inv.taxAmount),
    total: Number(inv.totalAmount),
    amountPaid: Number(inv.shippingCost), // shippingCost repurposed as amountPaid
    balanceDue: Number(inv.totalAmount) - Number(inv.shippingCost),
    notes: inv.notes,
    lineItems: inv.lineItems?.map((li: any) => ({
      id: li.id,
      description: li.description,
      quantity: Number(li.quantity),
      unitPrice: Number(li.unitCost),
      total: Number(li.totalCost),
      taxable: li.unit === 'taxable', // unit field repurposed as taxable flag
    })) ?? [],
    lineItemCount: inv._count?.lineItems ?? inv.lineItems?.length ?? 0,
    createdAt: inv.createdAt,
    updatedAt: inv.updatedAt,
  }
}

// ─── GET /api/billing-invoices ──────────────────────────────────────────────
// List billing invoices with filters + summary stats
export const GET = withVenue(withAuth('INVENTORY_VIEW', async function GET(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const locationId = ctx.auth.locationId
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const customerId = searchParams.get('customerId')
    const search = searchParams.get('search')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)

    const where: Record<string, unknown> = {
      locationId,
      deletedAt: null,
      source: BILLING_SOURCE,
    }

    if (status) {
      // Map friendly status names to InvoiceStatus enum values
      const statusMap: Record<string, string> = {
        draft: 'draft',
        sent: 'pending',
        viewed: 'approved',
        paid: 'paid',
        overdue: 'pending', // overdue is pending + past due date
        cancelled: 'voided',
        void: 'voided',
      }
      const mappedStatus = statusMap[status] || status
      where.status = mappedStatus as never

      // For overdue, also filter by due date
      if (status === 'overdue') {
        where.dueDate = { lt: new Date() }
      }
    }

    if (customerId) where.vendorId = customerId

    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search } },
        { vendor: { name: { contains: search } } },
        { notes: { contains: search } },
      ]
    }

    if (startDate || endDate) {
      where.invoiceDate = {
        ...(startDate ? { gte: new Date(startDate) } : {}),
        ...(endDate ? { lte: new Date(endDate + 'T23:59:59Z') } : {}),
      }
    }

    const [invoices, total] = await Promise.all([
      db.invoice.findMany({
        where: where as any,
        include: {
          vendor: { select: { id: true, name: true, email: true, phone: true, address: true } },
          _count: { select: { lineItems: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.invoice.count({ where: where as any }),
    ])

    // Summary stats
    const now = new Date()
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const [outstandingAgg, overdueAgg, paidThisMonthAgg] = await Promise.all([
      // Outstanding: sent (pending) or viewed (approved) invoices
      db.invoice.aggregate({
        where: {
          locationId,
          deletedAt: null,
          source: BILLING_SOURCE,
          status: { in: ['pending' as never, 'approved' as never] },
        },
        _sum: { totalAmount: true },
        _count: true,
      }),
      // Overdue: pending/approved invoices past due date
      db.invoice.aggregate({
        where: {
          locationId,
          deletedAt: null,
          source: BILLING_SOURCE,
          status: { in: ['pending' as never, 'approved' as never] },
          dueDate: { lt: now },
        },
        _sum: { totalAmount: true },
        _count: true,
      }),
      // Paid this month
      db.invoice.aggregate({
        where: {
          locationId,
          deletedAt: null,
          source: BILLING_SOURCE,
          status: 'paid' as never,
          paidDate: { gte: firstOfMonth },
        },
        _sum: { totalAmount: true },
        _count: true,
      }),
    ])

    return NextResponse.json({
      data: {
        invoices: invoices.map(serializeInvoice),
        total,
        page,
        totalPages: Math.ceil(total / limit),
        summary: {
          outstanding: {
            count: outstandingAgg._count,
            total: Number(outstandingAgg._sum.totalAmount ?? 0),
          },
          overdue: {
            count: overdueAgg._count,
            total: Number(overdueAgg._sum.totalAmount ?? 0),
          },
          paidThisMonth: {
            count: paidThisMonthAgg._count,
            total: Number(paidThisMonthAgg._sum.totalAmount ?? 0),
          },
        },
      },
    })
  } catch (error) {
    console.error('Billing invoice list error:', error)
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 })
  }
}))

// ─── POST /api/billing-invoices ─────────────────────────────────────────────
// Create a new billing invoice
export const POST = withVenue(withAuth('INVENTORY_MANAGE', async function POST(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const locationId = ctx.auth.locationId
    const body = await request.json()
    const {
      customerId,
      customerName,
      customerEmail,
      customerAddress,
      lineItems = [],
      notes,
      paymentTermsDays,
      dueDate: explicitDueDate,
    } = body

    if (!customerName && !customerId) {
      return NextResponse.json({ error: 'Customer name or ID is required' }, { status: 400 })
    }
    if (!lineItems.length) {
      return NextResponse.json({ error: 'At least one line item is required' }, { status: 400 })
    }

    const invSettings = await getInvoicingSettings(locationId)
    const taxRate = invSettings.defaultTaxRate || 0
    const termsDays = paymentTermsDays ?? invSettings.defaultPaymentTermsDays ?? 30

    // Resolve or create a vendor record as the "customer"
    let vendorId = customerId
    if (!vendorId) {
      // Try to find existing vendor with this name at this location
      const existing = await db.vendor.findFirst({
        where: { locationId, name: customerName, deletedAt: null },
      })
      if (existing) {
        vendorId = existing.id
        // Update email/address if provided
        if (customerEmail || customerAddress) {
          await db.vendor.update({
            where: { id: existing.id },
            data: {
              ...(customerEmail ? { email: customerEmail } : {}),
              ...(customerAddress ? { address: customerAddress } : {}),
            },
          })
        }
      } else {
        const newVendor = await db.vendor.create({
          data: {
            locationId,
            name: customerName,
            email: customerEmail || null,
            address: customerAddress || null,
            paymentTerms: `Net ${termsDays}`,
            notes: 'Billing customer',
          },
        })
        vendorId = newVendor.id
      }
    }

    // Generate invoice number
    const invoiceNumber = await generateInvoiceNumber(locationId)

    // Calculate totals
    let subtotal = 0
    const processedLineItems: Array<{
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

      processedLineItems.push({
        locationId,
        description: item.description || null,
        quantity: qty,
        unit: item.taxable !== false ? 'taxable' : 'nontaxable', // repurpose unit field
        unitCost: price,
        totalCost: lineTotal,
      })
    }

    // Calculate tax on taxable items only
    const taxableSubtotal = processedLineItems
      .filter(li => li.unit === 'taxable')
      .reduce((sum, li) => sum + li.totalCost, 0)
    const taxAmount = taxRate > 0 ? (taxableSubtotal * taxRate) / 100 : 0
    const totalAmount = subtotal + taxAmount

    // Due date
    const dueDate = explicitDueDate
      ? new Date(explicitDueDate)
      : new Date(Date.now() + termsDays * 24 * 60 * 60 * 1000)

    const invoice = await db.invoice.create({
      data: {
        locationId,
        vendorId,
        invoiceNumber,
        invoiceDate: new Date(),
        dueDate,
        subtotal,
        taxAmount,
        shippingCost: 0, // amountPaid starts at 0
        totalAmount,
        status: 'draft' as never,
        source: BILLING_SOURCE,
        notes: notes || null,
        enteredById: ctx.auth.employeeId || null,
        createdById: ctx.auth.employeeId || null,
        updateCosts: false,
        addToInventory: false,
        lineItems: {
          create: processedLineItems,
        },
      },
      include: {
        vendor: { select: { id: true, name: true, email: true, phone: true, address: true } },
        lineItems: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    return NextResponse.json({ data: serializeInvoice(invoice) }, { status: 201 })
  } catch (error) {
    console.error('Create billing invoice error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Failed to create invoice', detail: message }, { status: 500 })
  }
}))
