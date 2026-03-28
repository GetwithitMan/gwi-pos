import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { invalidateMenuCache } from '@/lib/menu-cache'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { dispatchMenuStructureChanged } from '@/lib/socket-dispatch'
import { getLocationId } from '@/lib/location-cache'
import { getActorFromRequest, requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'

const log = createChildLogger('menu.modifiers')

// GET all modifier groups with their modifiers
// Optional query params:
//   - channel: 'online' | 'pos' - filter modifiers by channel visibility
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const channel = searchParams.get('channel') // 'online', 'pos', or null (admin - show all)

    // Get the location ID (cached)
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const modifierGroups = await db.modifierGroup.findMany({
      where: { locationId, deletedAt: null },
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

    return ok({
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
            ingredientId: mod.ingredientId,
            // Spirit fields
            spiritTier: mod.spiritTier,
            linkedBottleProductId: mod.linkedBottleProductId,
            linkedBottleProduct: mod.linkedBottleProduct ? {
              id: mod.linkedBottleProduct.id,
              name: mod.linkedBottleProduct.name,
              pourCost: mod.linkedBottleProduct.pourCost ? Number(mod.linkedBottleProduct.pourCost) : null,
            } : null,
            // Bar hot button
            showAsHotButton: (mod as any).showAsHotButton ?? false,
          })),
          linkedItems: group.menuItem ? [{ id: group.menuItem.id, name: group.menuItem.name }] : []
        }
      })
    })
  } catch (error) {
    console.error('Failed to fetch modifier groups:', error)
    return err('Failed to fetch modifier groups', 500)
  }
})

// POST create new modifier group
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, displayName, modifierTypes, minSelections, maxSelections, isRequired, allowStacking, hasOnlineOverride, isSpiritGroup, modifiers } = body

    if (!name?.trim()) {
      return err('Name is required')
    }

    // Get the location ID (cached)
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Auth check — require menu.edit_items permission
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.MENU_EDIT_ITEMS)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Get max sort order
    const maxSortOrder = await db.modifierGroup.aggregate({
      where: { locationId },
      _max: { sortOrder: true }
    })

    const modifierGroup = await db.modifierGroup.create({
      data: {
        locationId,
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
          create: modifiers.map((mod: { name: string; price: number; upsellPrice?: number; allowedPreModifiers?: string[]; extraPrice?: number; extraUpsellPrice?: number; childModifierGroupId?: string; commissionType?: string; commissionValue?: number; showOnPOS?: boolean; showOnline?: boolean; printerRouting?: string; printerIds?: string[]; spiritTier?: string; showAsHotButton?: boolean }, index: number) => ({
            locationId,
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
            showAsHotButton: (mod as any).showAsHotButton ?? false,
            sortOrder: index,
          }))
        } : undefined
      },
      include: {
        modifiers: true
      }
    })

    // Invalidate server-side menu cache
    invalidateMenuCache(locationId)

    // Notify cloud → NUC sync
    void notifyDataChanged({ locationId, domain: 'menu', action: 'created', entityId: modifierGroup.id })
    void pushUpstream()

    // Fire-and-forget socket dispatch for real-time menu structure updates
    void dispatchMenuStructureChanged(locationId, {
      action: 'modifier-group-updated',
      entityId: modifierGroup.id,
      entityType: 'modifier-group',
    }).catch(err => log.warn({ err }, 'fire-and-forget failed in menu.modifiers'))

    return ok({
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
    return err('Failed to create modifier group', 500)
  }
})
