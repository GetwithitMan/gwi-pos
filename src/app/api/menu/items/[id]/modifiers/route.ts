import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET modifier groups linked to a menu item
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const links = await db.menuItemModifierGroup.findMany({
      where: { menuItemId: id },
      include: {
        modifierGroup: {
          include: {
            modifiers: {
              where: { isActive: true },
              orderBy: { sortOrder: 'asc' },
              include: {
                linkedBottleProduct: {
                  select: {
                    id: true,
                    name: true,
                    pourCost: true,
                  },
                },
              },
            },
            spiritConfig: {
              include: {
                spiritCategory: {
                  select: { id: true, name: true, displayName: true }
                }
              }
            }
          }
        }
      },
      orderBy: { sortOrder: 'asc' }
    })

    return NextResponse.json({
      modifierGroups: links.map(link => ({
        id: link.modifierGroup.id,
        name: link.modifierGroup.name,
        displayName: link.modifierGroup.displayName,
        minSelections: link.modifierGroup.minSelections,
        maxSelections: link.modifierGroup.maxSelections,
        isRequired: link.modifierGroup.isRequired,
        isSpiritGroup: link.modifierGroup.isSpiritGroup,
        modifierTypes: (link.modifierGroup.modifierTypes as string[]) || ['universal'],
        spiritConfig: link.modifierGroup.spiritConfig ? {
          spiritCategoryId: link.modifierGroup.spiritConfig.spiritCategoryId,
          spiritCategoryName: link.modifierGroup.spiritConfig.spiritCategory.displayName || link.modifierGroup.spiritConfig.spiritCategory.name,
          upsellEnabled: link.modifierGroup.spiritConfig.upsellEnabled,
          upsellPromptText: link.modifierGroup.spiritConfig.upsellPromptText,
          defaultTier: link.modifierGroup.spiritConfig.defaultTier,
        } : null,
        modifiers: link.modifierGroup.modifiers.map(mod => ({
          id: mod.id,
          name: mod.name,
          displayName: mod.displayName,
          price: Number(mod.price),
          upsellPrice: mod.upsellPrice ? Number(mod.upsellPrice) : null,
          allowedPreModifiers: mod.allowedPreModifiers as string[] | null,
          extraPrice: mod.extraPrice ? Number(mod.extraPrice) : null,
          extraUpsellPrice: mod.extraUpsellPrice ? Number(mod.extraUpsellPrice) : null,
          isDefault: mod.isDefault,
          childModifierGroupId: mod.childModifierGroupId,
          // Spirit fields
          spiritTier: mod.spiritTier,
          linkedBottleProductId: mod.linkedBottleProductId,
          linkedBottleProduct: mod.linkedBottleProduct ? {
            id: mod.linkedBottleProduct.id,
            name: mod.linkedBottleProduct.name,
            pourCost: mod.linkedBottleProduct.pourCost ? Number(mod.linkedBottleProduct.pourCost) : null,
          } : null,
        }))
      }))
    })
  } catch (error) {
    console.error('Failed to fetch item modifiers:', error)
    return NextResponse.json(
      { error: 'Failed to fetch item modifiers' },
      { status: 500 }
    )
  }
}

// POST link modifier groups to menu item
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: menuItemId } = await params
    const body = await request.json()
    const { modifierGroupIds } = body

    if (!Array.isArray(modifierGroupIds)) {
      return NextResponse.json(
        { error: 'modifierGroupIds must be an array' },
        { status: 400 }
      )
    }

    // Get menu item to get locationId
    const menuItem = await db.menuItem.findUnique({
      where: { id: menuItemId },
      select: { locationId: true },
    })

    if (!menuItem) {
      return NextResponse.json(
        { error: 'Menu item not found' },
        { status: 404 }
      )
    }

    // Remove existing links
    await db.menuItemModifierGroup.deleteMany({
      where: { menuItemId }
    })

    // Create new links
    if (modifierGroupIds.length > 0) {
      await db.menuItemModifierGroup.createMany({
        data: modifierGroupIds.map((groupId: string, index: number) => ({
          locationId: menuItem.locationId,
          menuItemId,
          modifierGroupId: groupId,
          sortOrder: index,
        }))
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to link modifiers to item:', error)
    return NextResponse.json(
      { error: 'Failed to link modifiers to item' },
      { status: 500 }
    )
  }
}
