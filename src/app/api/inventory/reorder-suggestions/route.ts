import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

// GET - Return reorder suggestions for items below reorder point or par level
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return err('Location ID required')
    }

    // Get all trackable active items
    const items = await db.inventoryItem.findMany({
      where: {
        locationId,
        trackInventory: true,
        isActive: true,
        deletedAt: null,
      },
      include: {
        defaultVendor: {
          select: { id: true, name: true, phone: true, email: true },
        },
      },
    })

    // Filter items that need reordering
    const suggestions = items
      .filter(item => {
        const stock = Number(item.currentStock)
        const reorderPoint = item.reorderPoint ? Number(item.reorderPoint) : null
        const parLevel = item.parLevel ? Number(item.parLevel) : null

        // Item needs reorder if below reorder point OR below par level
        if (reorderPoint !== null && stock <= reorderPoint) return true
        if (parLevel !== null && stock < parLevel) return true
        return false
      })
      .map(item => {
        const stock = Number(item.currentStock)
        const reorderPoint = item.reorderPoint ? Number(item.reorderPoint) : null
        const parLevel = item.parLevel ? Number(item.parLevel) : null
        const reorderQty = item.reorderQty ? Number(item.reorderQty) : null

        // Determine severity
        let severity: 'critical' | 'warning' = 'warning'
        if (reorderPoint !== null && stock <= reorderPoint) {
          severity = 'critical'
        }

        // Calculate estimated cost
        const costPerUnit = item.lastInvoiceCost
          ? Number(item.lastInvoiceCost)
          : Number(item.costPerUnit)
        const estimatedCost = reorderQty ? reorderQty * costPerUnit : null

        return {
          id: item.id,
          name: item.name,
          sku: item.sku,
          category: item.category,
          department: item.department,
          currentStock: stock,
          storageUnit: item.storageUnit,
          parLevel,
          reorderPoint,
          reorderQty,
          costPerUnit,
          lastInvoiceCost: item.lastInvoiceCost ? Number(item.lastInvoiceCost) : null,
          estimatedCost,
          severity,
          vendor: item.defaultVendor,
        }
      })
      // Sort: critical first, then by name
      .sort((a, b) => {
        if (a.severity !== b.severity) {
          return a.severity === 'critical' ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })

    // Summary counts
    const criticalCount = suggestions.filter(s => s.severity === 'critical').length
    const warningCount = suggestions.filter(s => s.severity === 'warning').length

    return ok({
        suggestions,
        summary: {
          critical: criticalCount,
          warning: warningCount,
          total: suggestions.length,
        },
      })
  } catch (error) {
    console.error('Reorder suggestions error:', error)
    return err('Failed to fetch reorder suggestions', 500)
  }
})
