import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { cascadeCostUpdate } from '@/lib/cost-cascade'
import { convertUnits } from '@/lib/inventory/unit-conversion'
import { autoClear86ForRestockedItems } from '@/lib/inventory'

// POST - Receive items against PO
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json()
    const { employeeId, locationId, items, notes, createInvoice } = body

    if (!locationId || !employeeId) {
      return NextResponse.json({ error: 'locationId and employeeId required' }, { status: 400 })
    }

    if (!items?.length) {
      return NextResponse.json({ error: 'items array required' }, { status: 400 })
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.INVENTORY_MANAGE)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Track items with cost for post-transaction cascade
    const itemsWithCost: Array<{ inventoryItemId: string; actualCost: number }> = []
    const restockedFromZeroIds: string[] = []

    const result = await db.$transaction(async (tx) => {
      // 1. Load PO
      const order = await tx.vendorOrder.findFirst({
        where: { id: orderId, locationId, deletedAt: null },
        include: {
          lineItems: { where: { deletedAt: null } },
        },
      })

      if (!order) {
        throw new Error('NOT_FOUND')
      }
      if (order.status === 'cancelled') {
        throw new Error('CANCELLED')
      }
      if (order.status === 'received') {
        throw new Error('ALREADY_RECEIVED')
      }

      // 2. Build line item lookup
      const lineItemMap = new Map(order.lineItems.map(li => [li.id, li]))

      // 3. Batch-load all inventory items
      const invItemIds = order.lineItems.map(li => li.inventoryItemId)
      const invItems = await tx.inventoryItem.findMany({
        where: { id: { in: invItemIds }, locationId },
      })
      const invItemMap = new Map(invItems.map(i => [i.id, i]))

      // 4. Process each received item
      const stockUpdates: Array<{ inventoryItemId: string; name: string; added: number; newStock: number }> = []
      for (const item of items) {
        const lineItem = lineItemMap.get(item.lineItemId)
        if (!lineItem) {
          throw new Error(`Line item not found: ${item.lineItemId}`)
        }

        const invItem = invItemMap.get(lineItem.inventoryItemId)
        if (!invItem) {
          throw new Error(`Inventory item not found for line item: ${item.lineItemId}`)
        }

        const receivedQty = Number(item.receivedQty)
        const actualCost = item.actualCost != null ? Number(item.actualCost) : null

        // Validate: don't allow receiving more than was ordered (minus already received)
        const alreadyReceived = Number(lineItem.receivedQty ?? 0)
        const maxReceivable = Number(lineItem.quantity) - alreadyReceived
        if (receivedQty > maxReceivable + 0.0001) {
          throw new Error(`OVER_RECEIVE:${invItem.name}:${maxReceivable}`)
        }

        // Calculate normalizedQty for stock update (convert to storage units)
        let normalizedQty: number
        const lineUnit = lineItem.unit
        if (lineUnit === invItem.purchaseUnit && Number(invItem.unitsPerPurchase) > 0) {
          // Purchase unit → storage unit via unitsPerPurchase multiplier
          normalizedQty = receivedQty * Number(invItem.unitsPerPurchase)
        } else if (lineUnit === invItem.storageUnit) {
          normalizedQty = receivedQty
        } else {
          // Try unit conversion system — strict: block on mismatch
          const converted = convertUnits(receivedQty, lineUnit, invItem.storageUnit)
          if (converted === null) {
            throw new Error(`UNIT_MISMATCH:${invItem.name}:${lineUnit}:${invItem.storageUnit}`)
          }
          normalizedQty = converted
        }

        // Update inventory stock
        const quantityBefore = Number(invItem.currentStock)
        await tx.inventoryItem.update({
          where: { id: invItem.id },
          data: { currentStock: { increment: normalizedQty } },
        })

        // Track items restocked from zero for auto-un-86
        if (quantityBefore <= 0 && quantityBefore + normalizedQty > 0) {
          restockedFromZeroIds.push(invItem.id)
        }

        // Create transaction record
        const unitCost = actualCost ?? (lineItem.estimatedCost ? Number(lineItem.estimatedCost) : null)
        await tx.inventoryItemTransaction.create({
          data: {
            locationId,
            inventoryItemId: invItem.id,
            type: 'purchase',
            quantityBefore,
            quantityChange: normalizedQty,
            quantityAfter: quantityBefore + normalizedQty,
            unitCost: unitCost ?? 0,
            totalCost: unitCost ? unitCost * receivedQty : 0,
            reason: `Received from PO ${order.orderNumber ?? order.id}`,
            referenceType: 'vendor_order',
            referenceId: orderId,
            employeeId,
          },
        })

        // Update line item received qty
        await tx.vendorOrderLineItem.update({
          where: { id: item.lineItemId },
          data: {
            receivedQty: { increment: receivedQty },
            ...(actualCost != null ? { actualCost } : {}),
          },
        })

        // Track stock update for response
        stockUpdates.push({
          inventoryItemId: invItem.id,
          name: invItem.name,
          added: normalizedQty,
          newStock: quantityBefore + normalizedQty,
        })

        // Track for cost cascade (use actual cost if provided, otherwise fall back to estimated)
        const costForCascade = actualCost ?? (lineItem.estimatedCost ? Number(lineItem.estimatedCost) : null)
        if (costForCascade != null) {
          itemsWithCost.push({ inventoryItemId: invItem.id, actualCost: costForCascade })
        }
      }

      // 5. Determine new status
      const updatedLineItems = await tx.vendorOrderLineItem.findMany({
        where: { vendorOrderId: orderId, deletedAt: null },
      })

      const fullyReceived = updatedLineItems.every(
        li => li.receivedQty != null && Number(li.receivedQty) >= Number(li.quantity)
      )
      const newStatus = fullyReceived ? 'received' : 'partially_received'

      // Calculate totalActual
      let totalActual = 0
      for (const li of updatedLineItems) {
        if (li.receivedQty && li.actualCost) {
          totalActual += Number(li.receivedQty) * Number(li.actualCost)
        }
      }

      // 6. Update PO status
      await tx.vendorOrder.update({
        where: { id: orderId },
        data: {
          status: newStatus as any,
          totalActual,
          ...(newStatus === 'received' ? {
            receivedAt: new Date(),
            receivedById: employeeId,
          } : {}),
          ...(notes ? { notes } : {}),
        },
      })

      // 7. Optionally create invoice
      let invoiceId: string | null = null
      if (createInvoice) {
        const invoice = await tx.invoice.create({
          data: {
            locationId,
            vendorId: order.vendorId,
            invoiceNumber: `PO-${order.orderNumber ?? order.id.slice(-8)}`,
            invoiceDate: new Date(),
            status: 'draft',
            source: 'manual',
            subtotal: totalActual,
            totalAmount: totalActual,
            addToInventory: false,
            updateCosts: false,
            notes: `Created from PO #${order.orderNumber ?? order.id.slice(-8)}`,
          },
        })

        // Create invoice line items for received items
        const invoiceLineItems = []
        for (const item of items) {
          const lineItem = lineItemMap.get(item.lineItemId)
          if (!lineItem) continue
          const invItem = invItemMap.get(lineItem.inventoryItemId)
          if (!invItem) continue

          invoiceLineItems.push({
            locationId,
            invoiceId: invoice.id,
            inventoryItemId: invItem.id,
            description: invItem.name,
            quantity: Number(item.receivedQty),
            unit: item.unit,
            unitCost: item.actualCost ?? 0,
            totalCost: (item.actualCost ?? 0) * Number(item.receivedQty),
          })
        }

        if (invoiceLineItems.length > 0) {
          await tx.invoiceLineItem.createMany({ data: invoiceLineItems })
        }

        await tx.vendorOrder.update({
          where: { id: orderId },
          data: { linkedInvoiceId: invoice.id },
        })

        invoiceId = invoice.id
      }

      return { orderId, status: newStatus, itemsReceived: items.length, stockUpdates, invoiceId }
    })

    // Await cost cascade (stock already updated — log if costs fail but don't fail the request)
    if (itemsWithCost.length > 0) {
      try {
        for (const item of itemsWithCost) {
          await cascadeCostUpdate(item.inventoryItemId, item.actualCost, 'manual', locationId, orderId)
        }
      } catch (err) {
        console.error('[orders/receive] cascade failed (stock updated, costs may be stale):', err)
      }
    }

    // Auto-un-86 ingredients restocked from zero (fire-and-forget)
    if (restockedFromZeroIds.length > 0) {
      void autoClear86ForRestockedItems(restockedFromZeroIds).catch(err =>
        console.error('[orders/receive] auto-un-86 failed:', err)
      )
    }

    return NextResponse.json({ data: result })
  } catch (error) {
    const message = (error as Error).message
    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }
    if (message === 'CANCELLED') {
      return NextResponse.json({ error: 'Cannot receive against a cancelled purchase order' }, { status: 400 })
    }
    if (message === 'ALREADY_RECEIVED') {
      return NextResponse.json({ error: 'Purchase order already fully received' }, { status: 400 })
    }
    if (message.startsWith('OVER_RECEIVE:')) {
      const [, itemName, max] = message.split(':')
      return NextResponse.json({ error: `Cannot receive more than ordered. Max remaining for "${itemName}": ${max}` }, { status: 400 })
    }
    if (message.startsWith('UNIT_MISMATCH:')) {
      const parts = message.split(':')
      const itemName = parts[1]
      const fromUnit = parts[2]
      const toUnit = parts[3]
      return NextResponse.json({
        error: `Cannot convert ${fromUnit} → ${toUnit} for "${itemName}". Set the purchase unit or unitsPerPurchase on the item.`
      }, { status: 400 })
    }
    console.error('Receive purchase order error:', error)
    return NextResponse.json({ error: 'Failed to receive purchase order' }, { status: 500 })
  }
})
