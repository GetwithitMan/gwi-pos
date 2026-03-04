/**
 * MarginEdge shared sync helpers
 */
import { db } from '@/lib/db'
import { MarginEdgeClient } from '@/lib/marginedge-client'

interface SyncOptions {
  autoUpdateCosts: boolean
  costChangeAlertThreshold?: number
}

export interface InvoiceSyncResult {
  imported: number
  lineItemsProcessed: number
  costUpdates: number
  errors: string[]
}

export async function syncInvoicesForLocation(
  locationId: string,
  apiKey: string,
  restaurantId: string | undefined,
  syncOptions: SyncOptions,
  fromDate: string,
  toDate: string
): Promise<InvoiceSyncResult> {
  const client = new MarginEdgeClient(apiKey, restaurantId)
  const invoices = await client.getInvoices(fromDate, toDate)

  const mappings = await db.marginEdgeProductMapping.findMany({
    where: { locationId, isActive: true },
    select: { marginEdgeProductId: true, inventoryItemId: true },
  })
  const mappingByMeProductId = new Map(mappings.map(m => [m.marginEdgeProductId, m.inventoryItemId]))

  let imported = 0
  let lineItemsProcessed = 0
  let costUpdates = 0
  const errors: string[] = []

  for (const meInvoice of invoices) {
    try {
      const existing = await db.invoice.findFirst({
        where: { locationId, marginEdgeInvoiceId: meInvoice.id },
      })
      if (existing) continue

      let vendorId: string | null = null
      if (meInvoice.vendorName) {
        const vendor = await db.vendor.findFirst({
          where: { locationId, name: meInvoice.vendorName, deletedAt: null },
        })
        if (vendor) {
          vendorId = vendor.id
        } else {
          const newVendor = await db.vendor.create({
            data: { locationId, name: meInvoice.vendorName },
          })
          vendorId = newVendor.id
        }
      }

      if (!vendorId) {
        errors.push(`Invoice ${meInvoice.invoiceNumber || meInvoice.id}: no vendor`)
        continue
      }

      const invoiceDate = new Date(meInvoice.invoiceDate)
      const lineItems = meInvoice.lineItems || []
      const subtotal = lineItems.reduce((s, li) => s + li.totalCost, 0)
      const totalAmount = meInvoice.totalAmount ?? subtotal

      const invoice = await db.invoice.create({
        data: {
          locationId,
          vendorId,
          invoiceNumber: meInvoice.invoiceNumber || `ME-${meInvoice.id}`,
          invoiceDate,
          deliveryDate: meInvoice.deliveryDate ? new Date(meInvoice.deliveryDate) : null,
          subtotal,
          totalAmount,
          status: 'received',
          source: 'marginedge',
          marginEdgeInvoiceId: meInvoice.id,
        },
      })

      for (const li of lineItems) {
        const inventoryItemId = li.productId ? mappingByMeProductId.get(li.productId) : null

        await db.invoiceLineItem.create({
          data: {
            locationId,
            invoiceId: invoice.id,
            inventoryItemId: inventoryItemId ?? null,
            marginEdgeProductId: li.productId ?? null,
            description: li.description || li.productName,
            quantity: li.quantity,
            unit: li.unit,
            unitCost: li.unitCost,
            totalCost: li.totalCost,
          },
        })
        lineItemsProcessed++

        if (syncOptions.autoUpdateCosts && inventoryItemId) {
          try {
            const item = await db.inventoryItem.findUnique({
              where: { id: inventoryItemId },
              select: { id: true, costPerUnit: true, unitsPerPurchase: true },
            })
            if (item) {
              const newCost = item.unitsPerPurchase
                ? li.unitCost / Number(item.unitsPerPurchase)
                : li.unitCost
              const oldCost = Number(item.costPerUnit ?? 0)
              const changePct = oldCost > 0 ? Math.abs((newCost - oldCost) / oldCost) * 100 : 100

              if (changePct >= (syncOptions.costChangeAlertThreshold || 5) || oldCost === 0) {
                await db.inventoryItem.update({
                  where: { id: inventoryItemId },
                  data: {
                    costPerUnit: newCost,
                    lastInvoiceCost: li.unitCost,
                    lastInvoiceDate: invoiceDate,
                  },
                })
                await db.ingredientCostHistory.create({
                  data: {
                    locationId,
                    inventoryItemId,
                    oldCostPerUnit: oldCost,
                    newCostPerUnit: newCost,
                    changePercent: changePct,
                    source: 'marginedge',
                    invoiceId: invoice.id,
                    invoiceNumber: invoice.invoiceNumber,
                    vendorName: meInvoice.vendorName ?? null,
                    effectiveDate: invoiceDate,
                  },
                })
                costUpdates++
              }
            }
          } catch (err) {
            errors.push(`Cost update failed for item ${inventoryItemId}: ${err instanceof Error ? err.message : 'unknown'}`)
          }
        }
      }

      imported++
    } catch (err) {
      errors.push(`Invoice ${meInvoice.id}: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

  return { imported, lineItemsProcessed, costUpdates, errors }
}
