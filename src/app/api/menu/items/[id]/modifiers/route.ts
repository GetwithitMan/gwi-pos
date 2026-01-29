import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET modifier groups linked to a menu item
// Optional query params:
//   - channel: 'online' | 'pos' - filter modifiers by channel visibility
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const channel = searchParams.get('channel') // 'online', 'pos', or null (admin - show all)

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

    // For online channel, filter out groups that are not enabled for online at the item level
    let filteredLinks = links
    if (channel === 'online') {
      filteredLinks = links.filter(link => link.showOnline)
    }

    return NextResponse.json({
      modifierGroups: filteredLinks.map(link => {
        // Filter modifiers based on channel if specified
        let filteredModifiers = link.modifierGroup.modifiers
        if (channel === 'online') {
          filteredModifiers = link.modifierGroup.modifiers.filter(mod => mod.showOnline)
        } else if (channel === 'pos') {
          filteredModifiers = link.modifierGroup.modifiers.filter(mod => mod.showOnPOS)
        }

        return {
          id: link.modifierGroup.id,
          name: link.modifierGroup.name,
          displayName: link.modifierGroup.displayName,
          minSelections: link.modifierGroup.minSelections,
          maxSelections: link.modifierGroup.maxSelections,
          isRequired: link.modifierGroup.isRequired,
          allowStacking: link.modifierGroup.allowStacking,
          hasOnlineOverride: link.modifierGroup.hasOnlineOverride,
          isSpiritGroup: link.modifierGroup.isSpiritGroup,
          modifierTypes: (link.modifierGroup.modifierTypes as string[]) || ['universal'],
          showOnline: link.showOnline, // Item-level online visibility
          spiritConfig: link.modifierGroup.spiritConfig ? {
            spiritCategoryId: link.modifierGroup.spiritConfig.spiritCategoryId,
            spiritCategoryName: link.modifierGroup.spiritConfig.spiritCategory.displayName || link.modifierGroup.spiritConfig.spiritCategory.name,
            upsellEnabled: link.modifierGroup.spiritConfig.upsellEnabled,
            upsellPromptText: link.modifierGroup.spiritConfig.upsellPromptText,
            defaultTier: link.modifierGroup.spiritConfig.defaultTier,
          } : null,
          modifiers: filteredModifiers.map(mod => ({
            id: mod.id,
            name: mod.name,
            displayName: mod.displayName,
            price: Number(mod.price),
            upsellPrice: mod.upsellPrice ? Number(mod.upsellPrice) : null,
            allowedPreModifiers: mod.allowedPreModifiers as string[] | null,
            extraPrice: mod.extraPrice ? Number(mod.extraPrice) : null,
            extraUpsellPrice: mod.extraUpsellPrice ? Number(mod.extraUpsellPrice) : null,
            isDefault: mod.isDefault,
            showOnPOS: mod.showOnPOS,
            showOnline: mod.showOnline,
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
        }
      })
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
// Accepts either:
//   { modifierGroupIds: string[] } - legacy format, all showOnline=true
//   { modifierGroups: { id: string, showOnline?: boolean }[] } - new format with per-group online visibility
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: menuItemId } = await params
    const body = await request.json()
    const { modifierGroupIds, modifierGroups } = body

    // Support both old format (modifierGroupIds) and new format (modifierGroups with showOnline)
    let groupsToLink: { id: string; showOnline: boolean }[] = []

    if (modifierGroups && Array.isArray(modifierGroups)) {
      // New format: { id, showOnline }
      groupsToLink = modifierGroups.map((g: { id: string; showOnline?: boolean }) => ({
        id: g.id,
        showOnline: g.showOnline ?? true
      }))
    } else if (Array.isArray(modifierGroupIds)) {
      // Legacy format: just IDs, all showOnline=true
      groupsToLink = modifierGroupIds.map((id: string) => ({ id, showOnline: true }))
    } else {
      return NextResponse.json(
        { error: 'modifierGroupIds or modifierGroups must be an array' },
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
    if (groupsToLink.length > 0) {
      await db.menuItemModifierGroup.createMany({
        data: groupsToLink.map((group, index: number) => ({
          locationId: menuItem.locationId,
          menuItemId,
          modifierGroupId: group.id,
          sortOrder: index,
          showOnline: group.showOnline,
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
