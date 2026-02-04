import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/inventory/86-status
 *
 * Returns all inventory items with their 86 status and affected items count.
 * Used by the Quick 86 page.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const showOnly86d = searchParams.get('showOnly86d') === 'true'
    const search = searchParams.get('search')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Build where clause - include all ingredients (base and prep items)
    interface WhereClause {
      locationId: string
      deletedAt: null
      is86d?: boolean
      name?: { contains: string }
    }

    const where: WhereClause = {
      locationId,
      deletedAt: null,
    }

    if (showOnly86d) {
      where.is86d = true
    }

    if (search) {
      where.name = { contains: search }
    }

    // Get all ingredients with their menu item and modifier links
    const ingredients = await db.ingredient.findMany({
      where,
      include: {
        categoryRelation: {
          select: { id: true, name: true, icon: true, color: true }
        },
        // Parent ingredient (for prep items)
        parentIngredient: {
          select: { id: true, name: true, is86d: true }
        },
        // Child prep items (for base ingredients)
        childIngredients: {
          where: { deletedAt: null },
          select: { id: true, name: true, is86d: true }
        },
        // Menu items that use this ingredient
        menuItemIngredients: {
          where: { deletedAt: null },
          include: {
            menuItem: {
              select: { id: true, name: true, isActive: true, deletedAt: true }
            }
          }
        },
        // Modifiers linked to this ingredient
        linkedModifiers: {
          where: { deletedAt: null },
          include: {
            modifierGroup: {
              select: { id: true, name: true }
            }
          }
        },
        // Recipe components - where this ingredient is used as a component
        // Gets us to the output ingredient, then we can find what menu items use that output
        usedInRecipes: {
          where: { deletedAt: null },
          include: {
            output: {
              select: {
                id: true,
                name: true,
                menuItemIngredients: {
                  where: { deletedAt: null },
                  include: {
                    menuItem: {
                      select: { id: true, name: true }
                    }
                  }
                }
              }
            }
          }
        }
      },
      orderBy: [
        { parentIngredientId: 'asc' }, // Base items first, then prep items
        { categoryRelation: { name: 'asc' } },
        { name: 'asc' }
      ]
    })

    // Build response with affected items counts
    const items = ingredients.map(ingredient => {
      // Direct menu item links
      const directMenuItems = ingredient.menuItemIngredients
        .filter(mi => mi.menuItem && !mi.menuItem.deletedAt)
        .map(mi => ({
          id: mi.menuItem.id,
          name: mi.menuItem.name
        }))

      // Menu items through recipes (ingredient is a component of another ingredient used in items)
      const recipeMenuItems: { id: string; name: string }[] = []
      ingredient.usedInRecipes.forEach(recipe => {
        if (recipe.output?.menuItemIngredients) {
          recipe.output.menuItemIngredients.forEach(mi => {
            if (mi.menuItem && !recipeMenuItems.some(r => r.id === mi.menuItem.id)) {
              recipeMenuItems.push({
                id: mi.menuItem.id,
                name: mi.menuItem.name
              })
            }
          })
        }
      })

      // Combine and deduplicate menu items
      const allMenuItems = [...directMenuItems]
      recipeMenuItems.forEach(rm => {
        if (!allMenuItems.some(m => m.id === rm.id)) {
          allMenuItems.push(rm)
        }
      })

      // Linked modifiers
      const affectedModifiers = ingredient.linkedModifiers.map(mod => ({
        id: mod.id,
        name: mod.name,
        groupName: mod.modifierGroup?.name || 'Unknown Group'
      }))

      // Check if parent is 86'd (makes this prep item effectively 86'd too)
      const parentIs86d = ingredient.parentIngredient?.is86d || false
      const effectivelyIs86d = ingredient.is86d || parentIs86d

      return {
        id: ingredient.id,
        name: ingredient.name,
        category: ingredient.categoryRelation?.name || ingredient.category || 'Uncategorized',
        categoryIcon: ingredient.categoryRelation?.icon,
        categoryColor: ingredient.categoryRelation?.color,
        is86d: ingredient.is86d,
        effectivelyIs86d, // True if this or parent is 86'd
        parentIs86d,
        last86dAt: ingredient.last86dAt,
        showOnQuick86: ingredient.showOnQuick86,
        // Hierarchy info
        isBaseIngredient: ingredient.isBaseIngredient,
        parentIngredientId: ingredient.parentIngredientId,
        parentIngredientName: ingredient.parentIngredient?.name,
        childCount: ingredient.childIngredients?.length || 0,
        // Affected items
        affectedMenuItemsCount: allMenuItems.length,
        affectedModifiersCount: affectedModifiers.length,
        affectedMenuItems: allMenuItems.slice(0, 5), // Preview of first 5
        affectedModifiers: affectedModifiers.slice(0, 5), // Preview of first 5
        totalAffectedCount: allMenuItems.length + affectedModifiers.length
      }
    })

    // Quick list - items marked for quick access
    const quickList = items.filter(i => i.showOnQuick86)

    // Group by category for UI (base ingredients only, prep items nested)
    const byCategory: Record<string, typeof items> = {}
    const baseItems = items.filter(i => !i.parentIngredientId)
    baseItems.forEach(item => {
      const cat = item.category
      if (!byCategory[cat]) {
        byCategory[cat] = []
      }
      byCategory[cat].push(item)
    })

    // Map of prep items by parent
    const prepItemsByParent: Record<string, typeof items> = {}
    items.filter(i => i.parentIngredientId).forEach(item => {
      const parentId = item.parentIngredientId!
      if (!prepItemsByParent[parentId]) {
        prepItemsByParent[parentId] = []
      }
      prepItemsByParent[parentId].push(item)
    })

    return NextResponse.json({
      data: {
        items,
        quickList,
        byCategory,
        prepItemsByParent,
        total86d: items.filter(i => i.is86d).length,
        totalEffectively86d: items.filter(i => i.effectivelyIs86d).length,
        totalItems: items.length
      }
    })
  } catch (error) {
    console.error('Error fetching 86 status:', error)
    return NextResponse.json({ error: 'Failed to fetch 86 status' }, { status: 500 })
  }
}

/**
 * POST /api/inventory/86-status
 *
 * Toggle the 86 status of an ingredient.
 * Returns the updated ingredient and list of affected items.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { ingredientId, is86d, employeeId } = body

    if (!ingredientId || is86d === undefined) {
      return NextResponse.json(
        { error: 'ingredientId and is86d are required' },
        { status: 400 }
      )
    }

    // Get ingredient and verify it exists
    const ingredient = await db.ingredient.findUnique({
      where: { id: ingredientId },
      include: {
        menuItemIngredients: {
          where: { deletedAt: null },
          include: {
            menuItem: {
              select: { id: true, name: true }
            }
          }
        },
        linkedModifiers: {
          where: { deletedAt: null },
          include: {
            modifierGroup: {
              select: { id: true, name: true }
            }
          }
        },
        usedInRecipes: {
          where: { deletedAt: null },
          include: {
            output: {
              select: {
                id: true,
                name: true,
                menuItemIngredients: {
                  where: { deletedAt: null },
                  include: {
                    menuItem: {
                      select: { id: true, name: true }
                    }
                  }
                }
              }
            }
          }
        }
      }
    })

    if (!ingredient || ingredient.deletedAt) {
      return NextResponse.json({ error: 'Ingredient not found' }, { status: 404 })
    }

    // Update 86 status
    const updated = await db.ingredient.update({
      where: { id: ingredientId },
      data: {
        is86d,
        last86dAt: is86d ? new Date() : null,
        last86dBy: is86d ? employeeId : null
      }
    })

    // Collect affected items for response
    const affectedMenuItems: { id: string; name: string }[] = []

    // Direct menu items
    ingredient.menuItemIngredients.forEach(mi => {
      if (mi.menuItem && !affectedMenuItems.some(m => m.id === mi.menuItem.id)) {
        affectedMenuItems.push({
          id: mi.menuItem.id,
          name: mi.menuItem.name
        })
      }
    })

    // Through recipes
    ingredient.usedInRecipes.forEach(recipe => {
      if (recipe.output?.menuItemIngredients) {
        recipe.output.menuItemIngredients.forEach(mi => {
          if (mi.menuItem && !affectedMenuItems.some(m => m.id === mi.menuItem.id)) {
            affectedMenuItems.push({
              id: mi.menuItem.id,
              name: mi.menuItem.name
            })
          }
        })
      }
    })

    const affectedModifiers = ingredient.linkedModifiers.map(mod => ({
      id: mod.id,
      name: mod.name,
      groupName: mod.modifierGroup?.name || 'Unknown'
    }))

    return NextResponse.json({
      data: {
        ingredient: {
          id: updated.id,
          name: updated.name,
          is86d: updated.is86d,
          last86dAt: updated.last86dAt
        },
        affectedMenuItems,
        affectedModifiers,
        message: is86d
          ? `${updated.name} marked as 86. ${affectedMenuItems.length} menu items and ${affectedModifiers.length} modifiers affected.`
          : `${updated.name} is back in stock.`
      }
    })
  } catch (error) {
    console.error('Error updating 86 status:', error)
    return NextResponse.json({ error: 'Failed to update 86 status' }, { status: 500 })
  }
}

/**
 * PATCH /api/inventory/86-status
 *
 * Toggle the showOnQuick86 flag for an ingredient.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { ingredientId, showOnQuick86 } = body

    if (!ingredientId || showOnQuick86 === undefined) {
      return NextResponse.json(
        { error: 'ingredientId and showOnQuick86 are required' },
        { status: 400 }
      )
    }

    const updated = await db.ingredient.update({
      where: { id: ingredientId },
      data: { showOnQuick86 },
      select: {
        id: true,
        name: true,
        showOnQuick86: true
      }
    })

    return NextResponse.json({
      data: {
        ingredient: updated,
        message: showOnQuick86
          ? `${updated.name} added to Quick 86 list.`
          : `${updated.name} removed from Quick 86 list.`
      }
    })
  } catch (error) {
    console.error('Error updating Quick 86 status:', error)
    return NextResponse.json({ error: 'Failed to update Quick 86 status' }, { status: 500 })
  }
}
