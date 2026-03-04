import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import { MarginEdgeClient } from '@/lib/marginedge-client'

async function updateSyncStatus(locationId: string, updates: Record<string, unknown>): Promise<void> {
  try {
    const loc = await db.location.findUnique({ where: { id: locationId }, select: { settings: true } })
    if (!loc) return
    const parsed = parseSettings(loc.settings)
    await db.location.update({
      where: { id: locationId },
      data: { settings: { ...parsed, marginEdge: { ...parsed.marginEdge, ...updates } } as object },
    })
  } catch { /* non-fatal */ }
}

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const locations = await db.location.findMany({
    where: { deletedAt: null },
    select: { id: true, settings: true },
  })

  const results: Record<string, unknown> = {}

  for (const location of locations) {
    const settings = parseSettings(location.settings)
    const me = settings.marginEdge
    if (!me?.enabled || !me.apiKey) continue

    const client = new MarginEdgeClient(me.apiKey, me.restaurantId)
    const locationResult: Record<string, unknown> = {}

    // Sync yesterday's invoices
    if (me.syncOptions.syncInvoices) {
      try {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        const today = new Date().toISOString().split('T')[0]
        const invoices = await client.getInvoices(yesterday, today)

        // Load product mappings
        const mappings = await db.marginEdgeProductMapping.findMany({
          where: { locationId: location.id, isActive: true },
          select: { marginEdgeProductId: true, inventoryItemId: true },
        })
        const mappingByMeId = new Map(mappings.map(m => [m.marginEdgeProductId, m.inventoryItemId]))

        let imported = 0
        let costUpdates = 0

        for (const meInvoice of invoices) {
          try {
            // Skip already imported
            const existing = await db.invoice.findFirst({
              where: { locationId: location.id, marginEdgeInvoiceId: meInvoice.id },
            })
            if (existing) continue

            // Find vendor
            let vendorId: string | null = null
            if (meInvoice.vendorName) {
              const vendor = await db.vendor.findFirst({
                where: { locationId: location.id, name: meInvoice.vendorName, deletedAt: null },
              })
              if (vendor) {
                vendorId = vendor.id
              } else {
                const newVendor = await db.vendor.create({
                  data: { locationId: location.id, name: meInvoice.vendorName },
                })
                vendorId = newVendor.id
              }
            }
            if (!vendorId) continue

            const invoiceDate = new Date(meInvoice.invoiceDate)
            const lineItems = meInvoice.lineItems || []
            const subtotal = lineItems.reduce((s, li) => s + li.totalCost, 0)

            const invoice = await db.invoice.create({
              data: {
                locationId: location.id,
                vendorId,
                invoiceNumber: meInvoice.invoiceNumber || `ME-${meInvoice.id}`,
                invoiceDate,
                deliveryDate: meInvoice.deliveryDate ? new Date(meInvoice.deliveryDate) : null,
                subtotal,
                totalAmount: meInvoice.totalAmount ?? subtotal,
                status: 'received',
                source: 'marginedge',
                marginEdgeInvoiceId: meInvoice.id,
              },
            })

            for (const li of lineItems) {
              const inventoryItemId = li.productId ? mappingByMeId.get(li.productId) : null

              await db.invoiceLineItem.create({
                data: {
                  locationId: location.id,
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

              // Auto-update costs if mapped
              if (me.syncOptions.autoUpdateCosts && inventoryItemId) {
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

                    if (changePct >= (me.syncOptions.costChangeAlertThreshold || 5) || oldCost === 0) {
                      await db.inventoryItem.update({
                        where: { id: inventoryItemId },
                        data: { costPerUnit: newCost, lastInvoiceCost: li.unitCost, lastInvoiceDate: invoiceDate },
                      })
                      await db.ingredientCostHistory.create({
                        data: {
                          locationId: location.id, inventoryItemId,
                          oldCostPerUnit: oldCost, newCostPerUnit: newCost, changePercent: changePct,
                          source: 'marginedge', invoiceId: invoice.id,
                          invoiceNumber: invoice.invoiceNumber, vendorName: meInvoice.vendorName ?? null,
                          effectiveDate: invoiceDate,
                        },
                      })
                      costUpdates++
                    }
                  }
                } catch { /* non-fatal cost update */ }
              }
            }

            imported++
          } catch (err) {
            console.error(`[marginedge-sync] Invoice ${meInvoice.id} error:`, err instanceof Error ? err.message : 'unknown')
          }
        }

        locationResult.invoices = { imported, costUpdates }
        await updateSyncStatus(location.id, {
          lastSyncAt: new Date().toISOString(),
          lastInvoiceSyncAt: new Date().toISOString(),
          lastSyncStatus: 'success',
          lastSyncError: null,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown'
        locationResult.invoices = { error: msg.slice(0, 200) }
        await updateSyncStatus(location.id, {
          lastSyncAt: new Date().toISOString(),
          lastSyncStatus: 'error',
          lastSyncError: msg.slice(0, 500),
        })
      }
    }

    results[location.id] = locationResult
  }

  return NextResponse.json({ data: results })
}
