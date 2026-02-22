import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { invalidateMenuCache } from '@/lib/menu-cache'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { dispatchMenuStructureChanged } from '@/lib/socket-dispatch'

// GET single modifier group with modifiers
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const modifierGroup = await db.modifierGroup.findUnique({
      where: { id },
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
        menuItem: {
          select: { id: true, name: true }
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

    if (!modifierGroup) {
      return NextResponse.json(
        { error: 'Modifier group not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ data: {
      id: modifierGroup.id,
      name: modifierGroup.name,
      displayName: modifierGroup.displayName,
      modifierTypes: (modifierGroup.modifierTypes as string[]) || ['universal'],
      minSelections: modifierGroup.minSelections,
      maxSelections: modifierGroup.maxSelections,
      isRequired: modifierGroup.isRequired,
      allowStacking: modifierGroup.allowStacking,
      hasOnlineOverride: modifierGroup.hasOnlineOverride,
      sortOrder: modifierGroup.sortOrder,
      isSpiritGroup: modifierGroup.isSpiritGroup,
      spiritConfig: modifierGroup.spiritConfig ? {
        spiritCategoryId: modifierGroup.spiritConfig.spiritCategoryId,
        spiritCategoryName: modifierGroup.spiritConfig.spiritCategory.displayName || modifierGroup.spiritConfig.spiritCategory.name,
        upsellEnabled: modifierGroup.spiritConfig.upsellEnabled,
        upsellPromptText: modifierGroup.spiritConfig.upsellPromptText,
        defaultTier: modifierGroup.spiritConfig.defaultTier,
      } : null,
      modifiers: modifierGroup.modifiers.map(mod => ({
        id: mod.id,
        name: mod.name,
        displayName: mod.displayName,
        price: Number(mod.price),
        upsellPrice: mod.upsellPrice ? Number(mod.upsellPrice) : null,
        allowedPreModifiers: mod.allowedPreModifiers as string[] | null,
        allowNo: mod.allowNo,
        allowLite: mod.allowLite,
        allowExtra: mod.allowExtra,
        allowOnSide: mod.allowOnSide,
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
        printerRouting: mod.printerRouting,
        printerIds: mod.printerIds,
        ingredientId: mod.ingredientId,
        // Spirit fields
        spiritTier: mod.spiritTier,
        linkedBottleProductId: mod.linkedBottleProductId,
        linkedBottleProduct: mod.linkedBottleProduct ? {
          id: mod.linkedBottleProduct.id,
          name: mod.linkedBottleProduct.name,
          pourCost: mod.linkedBottleProduct.pourCost ? Number(mod.linkedBottleProduct.pourCost) : null,
        } : null,
      })),
      linkedItems: modifierGroup.menuItem ? [{ id: modifierGroup.menuItem.id, name: modifierGroup.menuItem.name }] : []
    } })
  } catch (error) {
    console.error('Failed to fetch modifier group:', error)
    return NextResponse.json(
      { error: 'Failed to fetch modifier group' },
      { status: 500 }
    )
  }
})

// PUT update modifier group
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, displayName, modifierTypes, minSelections, maxSelections, isRequired, allowStacking, hasOnlineOverride, isSpiritGroup, modifiers } = body

    // Update modifier group
    const modifierGroup = await db.modifierGroup.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(displayName !== undefined && { displayName }),
        ...(modifierTypes !== undefined && { modifierTypes }),
        ...(minSelections !== undefined && { minSelections }),
        ...(maxSelections !== undefined && { maxSelections }),
        ...(isRequired !== undefined && { isRequired }),
        ...(allowStacking !== undefined && { allowStacking }),
        ...(hasOnlineOverride !== undefined && { hasOnlineOverride }),
        ...(isSpiritGroup !== undefined && { isSpiritGroup }),
      }
    })

    // If modifiers array provided, update them
    if (modifiers && Array.isArray(modifiers)) {
      // Get existing modifier IDs
      const existingModifiers = await db.modifier.findMany({
        where: { modifierGroupId: id },
        select: { id: true }
      })
      const existingIds = new Set(existingModifiers.map(m => m.id))
      const providedIds = new Set(modifiers.filter((m: { id?: string }) => m.id).map((m: { id: string }) => m.id))

      // Delete modifiers not in the provided list
      const toDelete = [...existingIds].filter(existingId => !providedIds.has(existingId))
      if (toDelete.length > 0) {
        await db.modifier.updateMany({
          where: { id: { in: toDelete } },
          data: { deletedAt: new Date() },
        })
      }

      // Update or create modifiers
      for (let i = 0; i < modifiers.length; i++) {
        const mod = modifiers[i] as {
          id?: string
          name: string
          price?: number
          upsellPrice?: number | null
          allowedPreModifiers?: string[] | null
          extraPrice?: number | null
          extraUpsellPrice?: number | null
          isDefault?: boolean
          isActive?: boolean
          showOnPOS?: boolean
          showOnline?: boolean
          childModifierGroupId?: string | null
          commissionType?: string | null
          commissionValue?: number | null
          printerRouting?: string
          printerIds?: string[] | null
          ingredientId?: string | null
          spiritTier?: string | null
        }

        if (mod.id && existingIds.has(mod.id)) {
          // Update existing
          await db.modifier.update({
            where: { id: mod.id },
            data: {
              name: mod.name,
              price: mod.price ?? 0,
              upsellPrice: mod.upsellPrice ?? null,
              allowedPreModifiers: mod.allowedPreModifiers?.length ? mod.allowedPreModifiers : Prisma.DbNull,
              extraPrice: mod.extraPrice ?? undefined,
              extraUpsellPrice: mod.extraUpsellPrice ?? undefined,
              childModifierGroupId: mod.childModifierGroupId || null,
              commissionType: mod.commissionType || null,
              commissionValue: mod.commissionValue ?? null,
              isDefault: mod.isDefault !== undefined ? mod.isDefault : undefined,
              isActive: mod.isActive !== undefined ? mod.isActive : undefined,
              showOnPOS: mod.showOnPOS !== undefined ? mod.showOnPOS : undefined,
              showOnline: mod.showOnline !== undefined ? mod.showOnline : undefined,
              printerRouting: mod.printerRouting !== undefined ? mod.printerRouting : undefined,
              printerIds: mod.printerIds !== undefined ? (mod.printerIds && mod.printerIds.length > 0 ? mod.printerIds : Prisma.DbNull) : undefined,
              ingredientId: mod.ingredientId !== undefined ? (mod.ingredientId || null) : undefined,
              spiritTier: mod.spiritTier !== undefined ? mod.spiritTier : undefined,
              sortOrder: i,
            }
          })
        } else {
          // Create new
          await db.modifier.create({
            data: {
              locationId: modifierGroup.locationId,
              modifierGroupId: id,
              name: mod.name,
              price: mod.price ?? 0,
              upsellPrice: mod.upsellPrice ?? null,
              allowedPreModifiers: mod.allowedPreModifiers?.length ? mod.allowedPreModifiers : Prisma.DbNull,
              extraPrice: mod.extraPrice ?? undefined,
              extraUpsellPrice: mod.extraUpsellPrice ?? undefined,
              childModifierGroupId: mod.childModifierGroupId || null,
              commissionType: mod.commissionType || null,
              commissionValue: mod.commissionValue ?? null,
              isDefault: mod.isDefault ?? false,
              isActive: mod.isActive ?? true,
              showOnPOS: mod.showOnPOS ?? true,
              showOnline: mod.showOnline ?? true,
              printerRouting: mod.printerRouting ?? 'follow',
              printerIds: mod.printerIds && mod.printerIds.length > 0 ? mod.printerIds : Prisma.DbNull,
              ingredientId: mod.ingredientId || null,
              spiritTier: mod.spiritTier || null,
              sortOrder: i,
            }
          })
        }
      }
    }

    // Fetch updated data
    const updated = await db.modifierGroup.findUnique({
      where: { id },
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
        spiritConfig: {
          include: {
            spiritCategory: {
              select: { id: true, name: true, displayName: true }
            }
          }
        }
      }
    })

    // Invalidate server-side menu cache
    invalidateMenuCache(modifierGroup.locationId)

    // Notify cloud → NUC sync
    void notifyDataChanged({ locationId: modifierGroup.locationId, domain: 'menu', action: 'updated', entityId: id })

    // Fire-and-forget socket dispatch for real-time menu structure updates
    void dispatchMenuStructureChanged(modifierGroup.locationId, {
      action: 'modifier-group-updated',
      entityId: id,
      entityType: 'modifier-group',
    }).catch(() => {})

    return NextResponse.json({ data: {
      id: updated!.id,
      name: updated!.name,
      displayName: updated!.displayName,
      modifierTypes: (updated!.modifierTypes as string[]) || ['universal'],
      minSelections: updated!.minSelections,
      maxSelections: updated!.maxSelections,
      isRequired: updated!.isRequired,
      allowStacking: updated!.allowStacking,
      hasOnlineOverride: updated!.hasOnlineOverride,
      isSpiritGroup: updated!.isSpiritGroup,
      spiritConfig: updated!.spiritConfig ? {
        spiritCategoryId: updated!.spiritConfig.spiritCategoryId,
        spiritCategoryName: updated!.spiritConfig.spiritCategory.displayName || updated!.spiritConfig.spiritCategory.name,
        upsellEnabled: updated!.spiritConfig.upsellEnabled,
        upsellPromptText: updated!.spiritConfig.upsellPromptText,
        defaultTier: updated!.spiritConfig.defaultTier,
      } : null,
      modifiers: updated!.modifiers.map(mod => ({
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
        isDefault: mod.isDefault,
        isActive: mod.isActive,
        showOnPOS: mod.showOnPOS,
        showOnline: mod.showOnline,
        printerRouting: mod.printerRouting,
        printerIds: mod.printerIds,
        ingredientId: mod.ingredientId,
        // Spirit fields
        spiritTier: mod.spiritTier,
        linkedBottleProductId: mod.linkedBottleProductId,
        linkedBottleProduct: mod.linkedBottleProduct ? {
          id: mod.linkedBottleProduct.id,
          name: mod.linkedBottleProduct.name,
          pourCost: mod.linkedBottleProduct.pourCost ? Number(mod.linkedBottleProduct.pourCost) : null,
        } : null,
      }))
    } })
  } catch (error) {
    console.error('Failed to update modifier group:', error)
    return NextResponse.json(
      { error: 'Failed to update modifier group' },
      { status: 500 }
    )
  }
})

// DELETE modifier group
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Get locationId for cache invalidation
    const group = await db.modifierGroup.findUnique({ where: { id }, select: { locationId: true } })

    // Soft delete modifier group
    await db.modifierGroup.update({ where: { id }, data: { deletedAt: new Date() } })

    // Invalidate server-side menu cache
    if (group) {
      invalidateMenuCache(group.locationId)
      // Notify cloud → NUC sync
      void notifyDataChanged({ locationId: group.locationId, domain: 'menu', action: 'deleted', entityId: id })
      // Fire-and-forget socket dispatch for real-time menu structure updates
      void dispatchMenuStructureChanged(group.locationId, {
        action: 'modifier-group-updated',
        entityId: id,
        entityType: 'modifier-group',
      }).catch(() => {})
    }

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete modifier group:', error)
    return NextResponse.json(
      { error: 'Failed to delete modifier group' },
      { status: 500 }
    )
  }
})
