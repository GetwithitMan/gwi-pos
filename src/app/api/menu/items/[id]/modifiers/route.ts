import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET modifier groups for a menu item — reads from item-owned groups (ModifierGroup.menuItemId)
//
// ⚠️ ORDERING FLOW ENDPOINT - Use this for POS/online ordering (respects channel filtering)
// For admin menu builder, use /api/menu/items/[id]/modifier-groups instead.
//
// This endpoint:
// - Returns only top-level groups (child groups are nested under their parent modifier)
// - Filters modifiers by channel visibility (showOnPOS / showOnline)
// - Used by ModifierModal during order creation
//
// Optional query params:
//   - channel: 'online' | 'pos' - filter modifiers by channel visibility
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: menuItemId } = await params
    const { searchParams } = new URL(request.url)
    const channel = searchParams.get('channel')

    // Fetch item-owned modifier groups (where menuItemId is set on the group itself)
    // Only top-level groups (no parentModifierId on any modifier pointing to them from another group)
    const allGroups = await db.modifierGroup.findMany({
      where: {
        menuItemId,
        deletedAt: null,
      },
      include: {
        modifiers: {
          where: { deletedAt: null, isActive: true },
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
              select: { id: true, name: true, displayName: true },
            },
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    })

    // Build a map for child group lookups
    const groupMap = new Map(allGroups.map(g => [g.id, g]))

    // Identify child groups (groups referenced by a modifier's childModifierGroupId)
    const childGroupIds = new Set<string>()
    allGroups.forEach(g => {
      g.modifiers.forEach(m => {
        if (m.childModifierGroupId) childGroupIds.add(m.childModifierGroupId)
      })
    })

    // Only return top-level groups (not child groups — those are nested inside their parent modifier)
    const topLevelGroups = allGroups.filter(g => !childGroupIds.has(g.id))

    // Format response in the shape the POS ModifierModal expects
    return NextResponse.json({ data: {
      modifierGroups: topLevelGroups.map(group => {
        let filteredModifiers = group.modifiers
        if (channel === 'online') {
          filteredModifiers = group.modifiers.filter(mod => mod.showOnline)
        } else if (channel === 'pos') {
          filteredModifiers = group.modifiers.filter(mod => mod.showOnPOS)
        }

        return {
          id: group.id,
          name: group.name,
          displayName: group.displayName,
          minSelections: group.minSelections,
          maxSelections: group.maxSelections,
          isRequired: group.isRequired,
          allowStacking: group.allowStacking,
          hasOnlineOverride: group.hasOnlineOverride,
          isSpiritGroup: group.isSpiritGroup,
          modifierTypes: (group.modifierTypes as string[]) || ['universal'],
          tieredPricingConfig: group.tieredPricingConfig,
          exclusionGroupKey: group.exclusionGroupKey,
          showOnline: true,
          spiritConfig: group.spiritConfig ? {
            spiritCategoryId: group.spiritConfig.spiritCategoryId,
            spiritCategoryName: group.spiritConfig.spiritCategory.displayName || group.spiritConfig.spiritCategory.name,
            upsellEnabled: group.spiritConfig.upsellEnabled,
            upsellPromptText: group.spiritConfig.upsellPromptText,
            defaultTier: group.spiritConfig.defaultTier,
          } : null,
          modifiers: filteredModifiers.map(mod => ({
            id: mod.id,
            name: mod.name,
            displayName: mod.displayName,
            price: Number(mod.price),
            upsellPrice: mod.upsellPrice ? Number(mod.upsellPrice) : null,
            allowedPreModifiers: mod.allowedPreModifiers as string[] | null,
            allowNo: mod.allowNo,
            allowLite: mod.allowLite,
            allowOnSide: mod.allowOnSide,
            allowExtra: mod.allowExtra,
            extraPrice: mod.extraPrice ? Number(mod.extraPrice) : null,
            extraUpsellPrice: mod.extraUpsellPrice ? Number(mod.extraUpsellPrice) : null,
            isDefault: mod.isDefault,
            isLabel: mod.isLabel ?? false,
            showOnPOS: mod.showOnPOS,
            showOnline: mod.showOnline,
            childModifierGroupId: mod.childModifierGroupId,
            ingredientId: mod.ingredientId,
            // Spirit fields
            spiritTier: mod.spiritTier,
            linkedBottleProductId: mod.linkedBottleProductId,
            linkedBottleProduct: mod.linkedBottleProduct ? {
              id: mod.linkedBottleProduct.id,
              name: mod.linkedBottleProduct.name,
              pourCost: mod.linkedBottleProduct.pourCost ? Number(mod.linkedBottleProduct.pourCost) : null,
            } : null,
            is86d: false, // Field is on Ingredient, not Modifier — POS expects it so default to false
          })),
        }
      }),
    } })
  } catch (error) {
    console.error('Failed to fetch item modifiers:', error)
    return NextResponse.json(
      { error: 'Failed to fetch item modifiers' },
      { status: 500 }
    )
  }
})

// POST is no longer needed — modifier groups are item-owned, managed via
// /api/menu/items/[id]/modifier-groups (the ItemEditor API)
// Keeping a stub that returns a clear error if anything still calls it.
export const POST = withVenue(async function POST(request: NextRequest) {
  console.warn('Deprecated endpoint called: POST /api/menu/items/[id]/modifiers - should use /api/menu/items/[id]/modifier-groups')
  return NextResponse.json(
    { error: 'Shared modifier linking is deprecated. Use /api/menu/items/[id]/modifier-groups to manage item-owned modifier groups.' },
    { status: 410 }
  )
})
