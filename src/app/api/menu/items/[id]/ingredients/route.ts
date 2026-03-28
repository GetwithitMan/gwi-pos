import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { dispatchMenuItemChanged } from '@/lib/socket-dispatch'
import { invalidateMenuCache } from '@/lib/menu-cache'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withVenue } from '@/lib/with-venue'
import { getRequestLocationId } from '@/lib/request-context'
import { withAuth } from '@/lib/api-auth-middleware'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'

const log = createChildLogger('menu.items.id.ingredients')

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/menu/items/[id]/ingredients - Get ingredients for a menu item
export const GET = withVenue(async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: menuItemId } = await params

    // Verify menu item exists
    const menuItem = await db.menuItem.findUnique({
      where: { id: menuItemId },
      select: { id: true, locationId: true },
    })

    if (!menuItem) {
      return notFound('Menu item not found')
    }

    const ingredients = await db.menuItemIngredient.findMany({
      where: { menuItemId, deletedAt: null },
      include: {
        ingredient: {
          include: {
            swapGroup: {
              select: {
                id: true,
                name: true,
                ingredients: {
                  where: { isActive: true, deletedAt: null },
                  select: {
                    id: true,
                    name: true,
                    extraPrice: true,
                  },
                  orderBy: { sortOrder: 'asc' },
                },
              },
            },
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    })

    // Filter out any links where the ingredient itself was soft-deleted
    const activeIngredients = ingredients.filter(mi => mi.ingredient && !mi.ingredient.deletedAt)

    return ok(activeIngredients.map(mi => ({
        id: mi.id,
        ingredientId: mi.ingredientId,
        name: mi.ingredient.name,
        category: mi.ingredient.category,
        isIncluded: mi.isIncluded,
        sortOrder: mi.sortOrder,
        // Modification options (use override if set, otherwise ingredient default)
        allowNo: mi.allowNo ?? mi.ingredient.allowNo,
        allowLite: mi.allowLite ?? mi.ingredient.allowLite,
        allowOnSide: mi.allowOnSide ?? mi.ingredient.allowOnSide,
        allowExtra: mi.allowExtra ?? mi.ingredient.allowExtra,
        extraPrice: Number(mi.extraPrice ?? mi.ingredient.extraPrice),
        allowSwap: mi.ingredient.allowSwap,
        swapUpcharge: Number(mi.ingredient.swapUpcharge),
        needsVerification: mi.ingredient.needsVerification || false,
        // Swap options (ingredients that can be swapped for this one)
        swapGroup: mi.ingredient.swapGroup ? {
          id: mi.ingredient.swapGroup.id,
          name: mi.ingredient.swapGroup.name,
          ingredients: mi.ingredient.swapGroup.ingredients.map(ing => ({
            id: ing.id,
            name: ing.name,
            extraPrice: Number(ing.extraPrice),
          })),
        } : null,
        // Override flags
        hasExtraPriceOverride: mi.extraPrice !== null,
      })))
  } catch (error) {
    console.error('Error fetching menu item ingredients:', error)
    return err('Failed to fetch ingredients', 500)
  }
})

// POST /api/menu/items/[id]/ingredients - Save ingredients for a menu item
// Replaces all existing ingredient links
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: menuItemId } = await params
    const body = await request.json()
    // Array of { ingredientId, isIncluded?, allowNo?, allowLite?, allowExtra?, allowOnSide?, extraPriceOverride?, swapUpchargeOverride? }
    const { ingredients } = body

    if (!Array.isArray(ingredients)) {
      return err('ingredients array is required')
    }

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let locationId = getRequestLocationId()
    if (!locationId) {
      // Verify menu item exists and get locationId
      const menuItem = await db.menuItem.findUnique({
        where: { id: menuItemId },
        select: { id: true, locationId: true },
      })

      if (!menuItem) {
        return notFound('Menu item not found')
      }
      locationId = menuItem.locationId
    }

    // Deduplicate by ingredientId — keep last occurrence (latest settings win)
    const seen = new Set<string>()
    const deduped: typeof ingredients = []
    for (let i = ingredients.length - 1; i >= 0; i--) {
      if (!seen.has(ingredients[i].ingredientId)) {
        seen.add(ingredients[i].ingredientId)
        deduped.unshift(ingredients[i])
      }
    }

    // Verify all ingredient IDs exist (no locationId filter — the ingredient may have been
    // created under a different session locationId; the link record stamps locationId)
    const ingredientIds = deduped.map(i => i.ingredientId)
    const existingIngredients = await db.ingredient.findMany({
      where: { id: { in: ingredientIds }, deletedAt: null },
      select: { id: true },
    })
    const existingIds = new Set(existingIngredients.map(i => i.id))
    const invalidIds = ingredientIds.filter(id => !existingIds.has(id))
    if (invalidIds.length > 0) {
      return err(`Invalid ingredient IDs: ${invalidIds.join(', ')}`)
    }

    // Replace all existing links in a transaction
    // Hard delete is correct here — this is a full replace operation, not a sync delete.
    // Soft delete would violate the @@unique([menuItemId, ingredientId]) constraint
    // when re-creating the same links with updated toggle values.
    await db.$transaction(async (tx) => {
      await tx.menuItemIngredient.deleteMany({
        where: { menuItemId },
      })

      if (deduped.length > 0) {
        await tx.menuItemIngredient.createMany({
          data: deduped.map((ing, index) => ({
            locationId: locationId,
            menuItemId,
            ingredientId: ing.ingredientId,
            isIncluded: ing.isIncluded ?? true,
            isBase: ing.isBase ?? true,
            sortOrder: ing.sortOrder ?? index,
            quantity: ing.quantity ?? null,
            unit: ing.unit ?? null,
            allowNo: ing.allowNo ?? null,
            allowLite: ing.allowLite ?? null,
            allowExtra: ing.allowExtra ?? null,
            allowOnSide: ing.allowOnSide ?? null,
            extraPrice: ing.extraPrice ?? null,
          })),
        })
      }
    })

    // Fetch and return updated ingredients
    const updated = await db.menuItemIngredient.findMany({
      where: { menuItemId, deletedAt: null },
      include: {
        ingredient: {
          include: {
            swapGroup: {
              select: {
                id: true,
                name: true,
                ingredients: {
                  where: { isActive: true, deletedAt: null },
                  select: {
                    id: true,
                    name: true,
                    extraPrice: true,
                  },
                  orderBy: { sortOrder: 'asc' },
                },
              },
            },
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    })

    // Filter out links where ingredient was soft-deleted
    const activeUpdated = updated.filter(mi => mi.ingredient && !mi.ingredient.deletedAt)

    // Invalidate server-side menu cache
    invalidateMenuCache(locationId)

    // Fire-and-forget socket dispatch for real-time menu updates
    void dispatchMenuItemChanged(locationId, {
      itemId: menuItemId,
      action: 'updated',
      changes: { ingredients: true },
    }).catch(err => log.warn({ err }, 'fire-and-forget failed in menu.items.id.ingredients'))

    // Notify cloud → NUC sync for real-time updates
    void notifyDataChanged({ locationId, domain: 'menu', action: 'updated', entityId: menuItemId })
    void pushUpstream()

    return ok(activeUpdated.map(mi => ({
        id: mi.id,
        ingredientId: mi.ingredientId,
        name: mi.ingredient.name,
        category: mi.ingredient.category,
        isIncluded: mi.isIncluded,
        sortOrder: mi.sortOrder,
        allowNo: mi.allowNo ?? mi.ingredient.allowNo,
        allowLite: mi.allowLite ?? mi.ingredient.allowLite,
        allowOnSide: mi.allowOnSide ?? mi.ingredient.allowOnSide,
        allowExtra: mi.allowExtra ?? mi.ingredient.allowExtra,
        extraPrice: Number(mi.extraPrice ?? mi.ingredient.extraPrice),
        allowSwap: mi.ingredient.allowSwap,
        swapUpcharge: Number(mi.ingredient.swapUpcharge),
        needsVerification: mi.ingredient.needsVerification || false,
        swapGroup: mi.ingredient.swapGroup ? {
          id: mi.ingredient.swapGroup.id,
          name: mi.ingredient.swapGroup.name,
          ingredients: mi.ingredient.swapGroup.ingredients.map(ing => ({
            id: ing.id,
            name: ing.name,
            extraPrice: Number(ing.extraPrice),
          })),
        } : null,
        hasExtraPriceOverride: mi.extraPrice !== null,
      })))
  } catch (error) {
    console.error('Error saving menu item ingredients:', error)
    return err('Failed to save ingredients', 500)
  }
}))
