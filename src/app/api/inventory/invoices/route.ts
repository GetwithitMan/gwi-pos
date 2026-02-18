import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

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
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
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

    return NextResponse.json({ data: {
      invoices: invoices.map(inv => ({
        ...inv,
        totalAmount: Number(inv.totalAmount),
      })),
    } })
  } catch (error) {
    console.error('Invoices list error:', error)
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 })
  }
})

// POST - Create invoice with line items
export const POST = withVenue(async function POST(request: NextRequest) {
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
      return NextResponse.json({
        error: 'Location ID, vendor, invoice number, and date required',
      }, { status: 400 })
    }

    if (!lineItems || lineItems.length === 0) {
      return NextResponse.json({
        error: 'At least one line item required',
      }, { status: 400 })
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

    return NextResponse.json({ data: {
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
    } })
  } catch (error) {
    console.error('Create invoice error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Invoice with this number already exists' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 })
  }
})
