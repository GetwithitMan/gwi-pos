import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

// GET all modifier groups with their modifiers
export async function GET() {
  try {
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
      modifierGroups: modifierGroups.map(group => ({
        id: group.id,
        name: group.name,
        displayName: group.displayName,
        modifierTypes: (group.modifierTypes as string[]) || ['universal'],
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        isRequired: group.isRequired,
        sortOrder: group.sortOrder,
        isSpiritGroup: group.isSpiritGroup,
        spiritConfig: group.spiritConfig ? {
          spiritCategoryId: group.spiritConfig.spiritCategoryId,
          spiritCategoryName: group.spiritConfig.spiritCategory.displayName || group.spiritConfig.spiritCategory.name,
          upsellEnabled: group.spiritConfig.upsellEnabled,
          upsellPromptText: group.spiritConfig.upsellPromptText,
          defaultTier: group.spiritConfig.defaultTier,
        } : null,
        modifiers: group.modifiers.map(mod => ({
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
          childModifierGroupId: mod.childModifierGroupId,
          commissionType: mod.commissionType,
          commissionValue: mod.commissionValue ? Number(mod.commissionValue) : null,
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
      }))
    })
  } catch (error) {
    console.error('Failed to fetch modifier groups:', error)
    return NextResponse.json(
      { error: 'Failed to fetch modifier groups' },
      { status: 500 }
    )
  }
}

// POST create new modifier group
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, displayName, modifierTypes, minSelections, maxSelections, isRequired, modifiers } = body

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
        sortOrder: (maxSortOrder._max.sortOrder || 0) + 1,
        modifiers: modifiers?.length ? {
          create: modifiers.map((mod: { name: string; price: number; upsellPrice?: number; allowedPreModifiers?: string[]; extraPrice?: number; extraUpsellPrice?: number; childModifierGroupId?: string; commissionType?: string; commissionValue?: number }, index: number) => ({
            name: mod.name,
            price: mod.price || 0,
            upsellPrice: mod.upsellPrice ?? null,
            allowedPreModifiers: mod.allowedPreModifiers?.length ? mod.allowedPreModifiers : Prisma.DbNull,
            extraPrice: mod.extraPrice ?? null,
            extraUpsellPrice: mod.extraUpsellPrice ?? null,
            childModifierGroupId: mod.childModifierGroupId || null,
            commissionType: mod.commissionType || null,
            commissionValue: mod.commissionValue ?? null,
            sortOrder: index,
          }))
        } : undefined
      },
      include: {
        modifiers: true
      }
    })

    return NextResponse.json({
      id: modifierGroup.id,
      name: modifierGroup.name,
      displayName: modifierGroup.displayName,
      modifierTypes: (modifierGroup.modifierTypes as string[]) || ['universal'],
      minSelections: modifierGroup.minSelections,
      maxSelections: modifierGroup.maxSelections,
      isRequired: modifierGroup.isRequired,
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
      }))
    })
  } catch (error) {
    console.error('Failed to create modifier group:', error)
    return NextResponse.json(
      { error: 'Failed to create modifier group' },
      { status: 500 }
    )
  }
}
