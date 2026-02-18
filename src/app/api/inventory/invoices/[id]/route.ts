import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - Get single invoice with line items
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const invoice = await db.invoice.findUnique({
      where: { id },
      include: {
        vendor: {
          select: { id: true, name: true, accountNum: true },
        },
        lineItems: {
          include: {
            inventoryItem: {
              select: { id: true, name: true, sku: true, purchaseUnit: true },
            },
          },
        },
      },
    })

    if (!invoice || invoice.deletedAt) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    return NextResponse.json({
      invoice: {
        ...invoice,
        totalAmount: Number(invoice.totalAmount),
        lineItems: invoice.lineItems.map(li => ({
          ...li,
          quantity: Number(li.quantity),
          unitCost: Number(li.unitCost),
          totalCost: Number(li.totalCost),
        })),
      },
    })
  } catch (error) {
    console.error('Get invoice error:', error)
    return NextResponse.json({ error: 'Failed to fetch invoice' }, { status: 500 })
  }
})

// PUT - Update invoice or apply to inventory
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await db.invoice.findUnique({
      where: { id },
      include: { lineItems: true },
    })

    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Handle status changes
    if (body.status === 'received' && existing.status === 'pending') {
      // Pre-fetch all inventory items for the line items (batch instead of N+1)
      const lineItemInvIds = existing.lineItems
        .filter(li => li.inventoryItemId)
        .map(li => li.inventoryItemId!)
      const invItems = await db.inventoryItem.findMany({
        where: { id: { in: lineItemInvIds } },
      })
      const invItemMap = new Map(invItems.map(i => [i.id, i]))

      // Apply invoice to inventory - update stock levels and costs
      const transactionData: Parameters<typeof db.inventoryItemTransaction.create>[0]['data'][] = []

      for (const lineItem of existing.lineItems) {
        if (!lineItem.inventoryItemId) continue

        const item = invItemMap.get(lineItem.inventoryItemId)
        if (!item) continue

        const receivedQty = Number(lineItem.quantity)
        const newCost = Number(lineItem.unitCost)
        const currentStock = Number(item.currentStock)
        const currentCost = Number(item.purchaseCost)

        let newAvgCost = newCost
        if (item.costingMethod === 'weighted_average' && currentStock > 0) {
          // Weighted average: (currentStock * currentCost + newQty * newCost) / (currentStock + newQty)
          const totalValue = (currentStock * currentCost) + (receivedQty * newCost)
          const totalQty = currentStock + receivedQty
          newAvgCost = totalQty > 0 ? totalValue / totalQty : newCost
        }

        // Update inventory item (must be sequential — each has unique cost calculation)
        await db.inventoryItem.update({
          where: { id: lineItem.inventoryItemId },
          data: {
            currentStock: { increment: receivedQty },
            purchaseCost: newAvgCost,
            costPerUnit: newAvgCost / Number(item.unitsPerPurchase),
            lastPriceUpdate: new Date(),
            priceSource: 'invoice',
          },
        })

        // Collect transaction data for batch create
        transactionData.push({
          locationId: existing.locationId,
          inventoryItemId: lineItem.inventoryItemId,
          type: 'purchase',
          quantityBefore: currentStock,
          quantityChange: receivedQty,
          quantityAfter: currentStock + receivedQty,
          unitCost: newCost,
          totalCost: Number(lineItem.totalCost),
          reason: `Invoice ${existing.invoiceNumber}`,
        })
      }

      // Batch create all transaction records at once
      if (transactionData.length > 0) {
        await db.inventoryItemTransaction.createMany({ data: transactionData })
      }

      await db.invoice.update({
        where: { id },
        data: {
          status: 'received',
          receivedDate: new Date(),
        },
      })
    } else if (body.status === 'paid' && existing.status === 'received') {
      await db.invoice.update({
        where: { id },
        data: {
          status: 'paid',
          paidDate: new Date(),
        },
      })
    }

    // Handle other updates
    const updateData: Record<string, unknown> = {}
    if (body.notes !== undefined) updateData.notes = body.notes
    if (body.dueDate !== undefined) updateData.dueDate = body.dueDate ? new Date(body.dueDate) : null

    if (Object.keys(updateData).length > 0) {
      await db.invoice.update({
        where: { id },
        data: updateData,
      })
    }

    const invoice = await db.invoice.findUnique({
      where: { id },
      include: {
        vendor: {
          select: { id: true, name: true },
        },
        _count: {
          select: { lineItems: true },
        },
      },
    })

    return NextResponse.json({
      invoice: {
        ...invoice,
        totalAmount: invoice ? Number(invoice.totalAmount) : 0,
      },
    })
  } catch (error) {
    console.error('Update invoice error:', error)
    return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 })
  }
})

// DELETE - Soft delete invoice (only if pending)
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await db.invoice.findUnique({
      where: { id },
    })

    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    if (existing.status !== 'pending') {
      return NextResponse.json({
        error: 'Can only delete pending invoices',
      }, { status: 400 })
    }

    await db.invoice.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete invoice error:', error)
    return NextResponse.json({ error: 'Failed to delete invoice' }, { status: 500 })
  }
})
