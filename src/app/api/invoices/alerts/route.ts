import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

// GET /api/invoices/alerts — cost change alerts from last 30 days
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId')
    const threshold = parseFloat(searchParams.get('threshold') || '5')
    const days = parseInt(searchParams.get('days') || '30', 10) || 30

    if (!locationId) {
      return err('locationId is required')
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.INVENTORY_VIEW)
    if (!auth.authorized) return err(auth.error, auth.status)

    const since = new Date()
    since.setDate(since.getDate() - days)

    // Get cost changes that exceed the threshold
    // NOTE: ingredientCostHistory model resolves after prisma generate with new schema
    const alerts = await (db as any).ingredientCostHistory.findMany({
      where: {
        locationId,
        effectiveDate: { gte: since },
        OR: [
          { changePercent: { gte: threshold } },
          { changePercent: { lte: -threshold } },
        ],
      },
      include: {
        inventoryItem: {
          select: {
            id: true,
            name: true,
            purchaseUnit: true,
            storageUnit: true,
          },
        },
      },
      orderBy: { effectiveDate: 'desc' },
      take: 100,
    })

    // For each alert, find affected menu items via recipes
    const alertsWithMenuItems = await Promise.all(
      alerts.map(async (alert: any) => {
        const recipeIngredients = await db.menuItemRecipeIngredient.findMany({
          where: { inventoryItemId: alert.inventoryItemId, deletedAt: null },
          include: {
            recipe: {
              include: {
                menuItem: { select: { id: true, name: true, price: true } },
              },
            },
          },
        })

        return {
          id: alert.id,
          inventoryItemId: alert.inventoryItemId,
          inventoryItemName: alert.inventoryItem.name,
          oldCostPerUnit: Number(alert.oldCostPerUnit),
          newCostPerUnit: Number(alert.newCostPerUnit),
          changePercent: Number(alert.changePercent),
          source: alert.source,
          vendorName: alert.vendorName,
          invoiceId: alert.invoiceId,
          effectiveDate: alert.effectiveDate,
          affectedMenuItems: recipeIngredients.map(ri => ({
            id: ri.recipe.menuItem.id,
            name: ri.recipe.menuItem.name,
            price: Number(ri.recipe.menuItem.price),
          })),
        }
      })
    )

    return ok({ alerts: alertsWithMenuItems })
  } catch (error) {
    console.error('Cost alerts error:', error)
    return err('Failed to fetch cost alerts', 500)
  }
})
