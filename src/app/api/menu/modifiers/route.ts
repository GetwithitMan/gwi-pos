import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { invalidateMenuCache } from '@/lib/menu-cache'

// GET all modifier groups with their modifiers
// Optional query params:
//   - channel: 'online' | 'pos' - filter modifiers by channel visibility
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const channel = searchParams.get('channel') // 'online', 'pos', or null (admin - show all)

    const modifierGroups = await db.modifierGroup.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        modifiers: {
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
        menuItems: {
          include: {
            menuItem: {
              select: { id: true, name: true }
            }
          }
        },
        spiritConfig: {
          include: {
            spiritCategory: {
              select: { id: true, name: true, displayName: true }
            }
          }
        }
      }
    })

    return NextResponse.json({
      modifierGroups: modifierGroups.map(group => {
        // Filter modifiers based on channel if specified
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
          modifierTypes: (group.modifierTypes as string[]) || ['universal'],
          minSelections: group.minSelections,
          maxSelections: group.maxSelections,
          isRequired: group.isRequired,
          allowStacking: group.allowStacking,
          hasOnlineOverride: group.hasOnlineOverride,
          sortOrder: group.sortOrder,
          isSpiritGroup: group.isSpiritGroup,
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
            extraPrice: mod.extraPrice ? Number(mod.extraPrice) : null,
            extraUpsellPrice: mod.extraUpsellPrice ? Number(mod.extraUpsellPrice) : null,
            sortOrder: mod.sortOrder,
            isDefault: mod.isDefault,
            isActive: mod.isActive,
            showOnPOS: mod.showOnPOS,
            showOnline: mod.showOnline,
            childModifierGroupId: mod.childModifierGroupId,
            commissionType: mod.commissionType,
            commissionValue: mod.commissionValue ? Number(mod.commissionValue) : null,
            printerIds: mod.printerIds,
            // Spirit fields
            spiritTier: mod.spiritTier,
            linkedBottleProductId: mod.linkedBottleProductId,
            linkedBottleProduct: mod.linkedBottleProduct ? {
              id: mod.linkedBottleProduct.id,
              name: mod.linkedBottleProduct.name,
              pourCost: mod.linkedBottleProduct.pourCost ? Number(mod.linkedBottleProduct.pourCost) : null,
            } : null,
          })),
          linkedItems: group.menuItems.map(link => ({
            id: link.menuItem.id,
            name: link.menuItem.name,
          }))
        }
      })
    })
  } catch (error) {
    console.error('Failed to fetch modifier groups:', error)
    return NextResponse.json(
      { error: 'Failed to fetch modifier groups' },
      { status: 500 }
    )
  }
})

// POST create new modifier group
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, displayName, modifierTypes, minSelections, maxSelections, isRequired, allowStacking, hasOnlineOverride, isSpiritGroup, modifiers } = body

    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      )
    }

    // Get the location
    const location = await db.location.findFirst()
    if (!location) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    // Get max sort order
    const maxSortOrder = await db.modifierGroup.aggregate({
      where: { locationId: location.id },
      _max: { sortOrder: true }
    })

    const modifierGroup = await db.modifierGroup.create({
      data: {
        locationId: location.id,
        name: name.trim(),
        displayName: displayName?.trim() || null,
        modifierTypes: modifierTypes || ['universal'],
        minSelections: minSelections || 0,
        maxSelections: maxSelections || 1,
        isRequired: isRequired || false,
        allowStacking: allowStacking || false,
        hasOnlineOverride: hasOnlineOverride || false,
        isSpiritGroup: isSpiritGroup || false,
        sortOrder: (maxSortOrder._max.sortOrder || 0) + 1,
        modifiers: modifiers?.length ? {
          create: modifiers.map((mod: { name: string; price: number; upsellPrice?: number; allowedPreModifiers?: string[]; extraPrice?: number; extraUpsellPrice?: number; childModifierGroupId?: string; commissionType?: string; commissionValue?: number; showOnPOS?: boolean; showOnline?: boolean; printerRouting?: string; printerIds?: string[]; spiritTier?: string }, index: number) => ({
            locationId: location.id,
            name: mod.name,
            price: mod.price || 0,
            upsellPrice: mod.upsellPrice ?? null,
            allowedPreModifiers: mod.allowedPreModifiers?.length ? mod.allowedPreModifiers : Prisma.DbNull,
            extraPrice: mod.extraPrice ?? null,
            extraUpsellPrice: mod.extraUpsellPrice ?? null,
            childModifierGroupId: mod.childModifierGroupId || null,
            commissionType: mod.commissionType || null,
            commissionValue: mod.commissionValue ?? null,
            showOnPOS: mod.showOnPOS ?? true,
            showOnline: mod.showOnline ?? true,
            printerRouting: mod.printerRouting ?? 'follow',
            printerIds: mod.printerIds && mod.printerIds.length > 0 ? mod.printerIds : Prisma.DbNull,
            spiritTier: mod.spiritTier || null,
            sortOrder: index,
          }))
        } : undefined
      },
      include: {
        modifiers: true
      }
    })

    // Invalidate server-side menu cache
    invalidateMenuCache(location.id)

    return NextResponse.json({
      id: modifierGroup.id,
      name: modifierGroup.name,
      displayName: modifierGroup.displayName,
      modifierTypes: (modifierGroup.modifierTypes as string[]) || ['universal'],
      minSelections: modifierGroup.minSelections,
      maxSelections: modifierGroup.maxSelections,
      isRequired: modifierGroup.isRequired,
      allowStacking: modifierGroup.allowStacking,
      hasOnlineOverride: modifierGroup.hasOnlineOverride,
      modifiers: modifierGroup.modifiers.map(mod => ({
        id: mod.id,
        name: mod.name,
        price: Number(mod.price),
        upsellPrice: mod.upsellPrice ? Number(mod.upsellPrice) : null,
        allowedPreModifiers: mod.allowedPreModifiers as string[] | null,
        extraPrice: mod.extraPrice ? Number(mod.extraPrice) : null,
        extraUpsellPrice: mod.extraUpsellPrice ? Number(mod.extraUpsellPrice) : null,
        childModifierGroupId: mod.childModifierGroupId,
        commissionType: mod.commissionType,
        commissionValue: mod.commissionValue ? Number(mod.commissionValue) : null,
        showOnPOS: mod.showOnPOS,
        showOnline: mod.showOnline,
        printerRouting: mod.printerRouting,
        printerIds: mod.printerIds,
      }))
    })
  } catch (error) {
    console.error('Failed to create modifier group:', error)
    return NextResponse.json(
      { error: 'Failed to create modifier group' },
      { status: 500 }
    )
  }
})
