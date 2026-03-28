/**
 * Legacy Inventory Route — MenuItem.currentStock
 *
 * DUAL INVENTORY SYSTEM:
 * 1. Legacy system (this file): Operates on MenuItem.currentStock / MenuItem.trackInventory.
 *    Used by the admin UI for simple per-item stock counts (e.g., "5 burgers left").
 *    Transactions stored in InventoryTransaction (keyed by menuItemId).
 *
 * 2. COGS system (src/lib/inventory/order-deduction.ts): Operates on InventoryItem.currentStock.
 *    Used by the order deduction pipeline for ingredient-level stock tracking tied to recipes.
 *    Transactions stored in InventoryItemTransaction (keyed by inventoryItemId).
 *
 * These two systems are independent. Changes here do NOT affect InventoryItem stock and vice versa.
 * The COGS system is the authoritative source for ingredient-level inventory and cost tracking.
 */
import { NextRequest } from 'next/server'
import { db as prisma } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { SOCKET_EVENTS } from '@/lib/socket-events'
import type { InventoryAdjustmentPayload, InventoryStockChangePayload } from '@/lib/socket-events'
import { queueSocketEvent, flushOutboxSafe } from '@/lib/socket-outbox'
import { withAuth } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

// GET - List inventory levels and transactions
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const menuItemId = searchParams.get('menuItemId')
    const lowStockOnly = searchParams.get('lowStockOnly') === 'true'

    if (!locationId) {
      return err('Location ID required')
    }

    // Get items with inventory tracking
    const where: Record<string, unknown> = {
      locationId,
      trackInventory: true,
    }
    if (menuItemId) where.id = menuItemId
    if (lowStockOnly) {
      where.currentStock = { lte: prisma.menuItem.fields.lowStockAlert }
    }

    const items = await prisma.menuItem.findMany({
      where,
      select: {
        id: true,
        name: true,
        currentStock: true,
        lowStockAlert: true,
        isAvailable: true,
        category: {
          select: { id: true, name: true },
        },
      },
      orderBy: [{ currentStock: 'asc' }, { name: 'asc' }],
    })

    // Get recent transactions
    const transactions = await prisma.inventoryTransaction.findMany({
      where: { locationId: locationId as string },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    // Batch fetch menu item names (2 queries total, not N+1)
    const transactionItemIds = [...new Set(transactions.map(t => t.menuItemId))]
    const transactionItems = transactionItemIds.length > 0
      ? await prisma.menuItem.findMany({
          where: { id: { in: transactionItemIds } },
          select: { id: true, name: true },
        })
      : []
    const itemNameMap = new Map(transactionItems.map(i => [i.id, i.name]))

    return ok({
      items: items.map(i => ({
        id: i.id,
        name: i.name,
        categoryId: i.category.id,
        categoryName: i.category.name,
        currentStock: i.currentStock ?? 0,
        lowStockAlert: i.lowStockAlert ?? 0,
        isLowStock: (i.currentStock ?? 0) <= (i.lowStockAlert ?? 0),
        isOutOfStock: (i.currentStock ?? 0) <= 0,
        isAvailable: i.isAvailable,
      })),
      transactions: transactions.map(t => ({
        id: t.id,
        menuItemId: t.menuItemId,
        menuItemName: itemNameMap.get(t.menuItemId) || 'Unknown Item',
        type: t.type,
        quantityBefore: t.quantityBefore,
        quantityChange: t.quantityChange,
        quantityAfter: t.quantityAfter,
        reason: t.reason,
        vendorName: t.vendorName,
        invoiceNumber: t.invoiceNumber,
        unitCost: t.unitCost ? Number(t.unitCost) : null,
        totalCost: t.totalCost ? Number(t.totalCost) : null,
        createdAt: t.createdAt,
      })),
    })
  } catch (error) {
    console.error('Inventory error:', error)
    return err('Failed to fetch inventory', 500)
  }
})

// POST - Record inventory transaction
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      menuItemId,
      type,
      quantityChange,
      reason,
      vendorName,
      invoiceNumber,
      unitCost,
      employeeId,
    } = body

    if (!locationId || !menuItemId || !type || quantityChange === undefined) {
      return err('Location ID, menu item ID, type, and quantity change required')
    }

    // Get current stock
    const item = await prisma.menuItem.findUnique({
      where: { id: menuItemId },
      select: { id: true, name: true, currentStock: true, lowStockAlert: true },
    })

    if (!item) {
      return notFound('Menu item not found')
    }

    const quantityBefore = item.currentStock ?? 0
    const quantityAfter = quantityBefore + quantityChange

    // Wrap transaction record + stock update + socket outbox in an atomic transaction
    // to prevent TOCTOU race between read and write.
    const { transaction } = await prisma.$transaction(async (tx) => {
      const txRecord = await tx.inventoryTransaction.create({
        data: {
          locationId,
          menuItemId,
          type,
          quantityBefore,
          quantityChange,
          quantityAfter,
          reason,
          vendorName,
          invoiceNumber,
          unitCost,
          totalCost: unitCost ? unitCost * Math.abs(quantityChange) : null,
          employeeId,
        },
      })

      const isAvailable = quantityAfter > 0
      await tx.menuItem.update({
        where: { id: menuItemId },
        data: {
          currentStock: quantityAfter,
          isAvailable,
        },
      })

      // Queue critical socket events inside the transaction (outbox pattern)
      const stockLevel = quantityAfter <= 0 ? 'critical'
        : quantityAfter <= (item.lowStockAlert ?? 0) ? 'low'
        : quantityAfter <= (item.lowStockAlert ?? 0) * 2 ? 'ok'
        : 'good'

      const stockPayload: InventoryStockChangePayload = {
        ingredientId: menuItemId,
        name: item.name,
        currentStock: quantityAfter,
        previousStock: quantityBefore,
        unit: 'each',
        stockLevel,
      }
      await queueSocketEvent(tx, locationId, SOCKET_EVENTS.INVENTORY_STOCK_CHANGE, stockPayload)

      const adjustPayload: InventoryAdjustmentPayload = {
        adjustments: [{
          ingredientId: menuItemId,
          name: item.name,
          previousStock: quantityBefore,
          newStock: quantityAfter,
          change: quantityChange,
          unit: 'each',
        }],
        adjustedById: employeeId || '',
        adjustedByName: '',
        totalItems: 1,
      }
      await queueSocketEvent(tx, locationId, SOCKET_EVENTS.INVENTORY_ADJUSTMENT, adjustPayload)

      return { transaction: txRecord }
    })

    // Transaction committed — flush outbox
    flushOutboxSafe(locationId)

    void notifyDataChanged({ locationId, domain: 'inventory', action: 'created', entityId: transaction.id })
    pushUpstream()

    // Check for low stock alert (non-critical, outside transaction)
    if (quantityAfter <= (item.lowStockAlert ?? 0) && quantityAfter > 0) {
      await prisma.stockAlert.create({
        data: {
          locationId,
          menuItemId,
          alertType: 'low_stock',
          currentStock: quantityAfter,
          threshold: item.lowStockAlert ?? 0,
        },
      })
    } else if (quantityAfter <= 0) {
      await prisma.stockAlert.create({
        data: {
          locationId,
          menuItemId,
          alertType: 'out_of_stock',
          currentStock: 0,
          threshold: 0,
        },
      })
    }

    return ok({
      transaction: {
        id: transaction.id,
        type: transaction.type,
        quantityBefore,
        quantityChange,
        quantityAfter,
      },
      newStock: quantityAfter,
      isAvailable: quantityAfter > 0,
    })
  } catch (error) {
    console.error('Inventory transaction error:', error)
    return err('Failed to record transaction', 500)
  }
}))
