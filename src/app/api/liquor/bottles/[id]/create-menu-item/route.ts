import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchMenuUpdate, dispatchMenuItemChanged } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'

/**
 * POST /api/liquor/bottles/[id]/create-menu-item
 * Create a menu item linked to a bottle product
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bottleId } = await params
    const body = await request.json()
    const {
      price,
      categoryId,
      name: customName,
      pourSizes,
      defaultPourSize,
    } = body

    // Get the bottle
    const bottle = await db.bottleProduct.findUnique({
      where: { id: bottleId },
      include: {
        spiritCategory: true,
        linkedMenuItems: { where: { deletedAt: null } },
      },
    })

    if (!bottle) {
      return NextResponse.json(
        { error: 'Bottle not found' },
        { status: 404 }
      )
    }

    // Check if bottle already has a menu item
    if (bottle.linkedMenuItems.length > 0) {
      return NextResponse.json(
        { error: 'This bottle already has a menu item', existingItem: bottle.linkedMenuItems[0] },
        { status: 400 }
      )
    }

    // Validate price
    if (price === undefined || price <= 0) {
      return NextResponse.json(
        { error: 'Valid price is required' },
        { status: 400 }
      )
    }

    // Auto-assign sortOrder based on tier (Wells first, then Call, Premium, Top Shelf)
    const tierSortBase: Record<string, number> = {
      well: 1,
      call: 100,
      premium: 200,
      top_shelf: 300,
    }
    const baseSortOrder = tierSortBase[bottle.tier] || 100

    // Find or create the target category
    let targetCategoryId = categoryId

    if (!targetCategoryId) {
      // Try to find a matching liquor category by spirit category name
      let category = await db.category.findFirst({
        where: {
          locationId: bottle.locationId,
          categoryType: 'liquor',
          name: { contains: bottle.spiritCategory.name },
          deletedAt: null,
        },
      })

      // If not found, try to find a general "Spirits" or similar category
      if (!category) {
        category = await db.category.findFirst({
          where: {
            locationId: bottle.locationId,
            categoryType: 'liquor',
            deletedAt: null,
          },
          orderBy: { sortOrder: 'asc' },
        })
      }

      // If still not found, create a category matching the spirit category
      if (!category) {
        category = await db.category.create({
          data: {
            locationId: bottle.locationId,
            name: bottle.spiritCategory.name,
            categoryType: 'liquor',
            color: '#8B5CF6', // Purple for liquor
            isActive: true,
            sortOrder: 100,
          },
        })
      }

      targetCategoryId = category.id
    }

    // Create the menu item
    const menuItem = await db.menuItem.create({
      data: {
        locationId: bottle.locationId,
        categoryId: targetCategoryId,
        linkedBottleProductId: bottleId,
        name: customName || bottle.name,
        displayName: bottle.displayName || null,
        price,
        cost: bottle.pourCost || undefined,
        sortOrder: baseSortOrder,
        isActive: true,
        showOnPOS: true,
        showOnline: false, // Default to not showing online
        trackInventory: true,
        // Pour sizes for liquor items
        pourSizes: pourSizes || {
          shot: 1.0,
          double: 2.0,
          tall: 1.5,
          short: 0.75,
        },
        defaultPourSize: defaultPourSize || 'shot',
        applyPourToModifiers: true,
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
        linkedBottleProduct: {
          select: {
            id: true,
            name: true,
            tier: true,
          },
        },
      },
    })

    // Dispatch socket events for real-time update (fire-and-forget)
    void dispatchMenuUpdate(bottle.locationId, {
      action: 'created',
      menuItemId: menuItem.id,
      bottleId: bottleId,
      name: menuItem.name,
    }).catch(() => {})
    void dispatchMenuItemChanged(bottle.locationId, {
      itemId: menuItem.id,
      action: 'created',
    }).catch(() => {})

    return NextResponse.json({ data: {
      success: true,
      menuItem: {
        id: menuItem.id,
        name: menuItem.name,
        price: Number(menuItem.price),
        category: menuItem.category,
        linkedBottleProduct: menuItem.linkedBottleProduct,
      },
    } })
  } catch (error) {
    console.error('Failed to create menu item from bottle:', error)
    return NextResponse.json(
      { error: 'Failed to create menu item' },
      { status: 500 }
    )
  }
})
