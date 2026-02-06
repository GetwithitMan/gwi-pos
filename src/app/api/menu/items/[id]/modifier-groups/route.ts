import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

interface RouteParams {
  params: Promise<{ id: string }>
}

// Type for modifier with optional child group
type ModifierWithChild = Prisma.ModifierGetPayload<{
  include: {
    ingredient: { select: { id: true; name: true; category: true } }
    childModifierGroup: {
      include: {
        modifiers: {
          include: {
            ingredient: { select: { id: true; name: true; category: true } }
          }
        }
      }
    }
  }
}>

// Helper function to recursively format modifier groups
function formatModifierGroup(group: {
  id: string
  name: string
  displayName: string | null
  minSelections: number
  maxSelections: number
  isRequired: boolean
  allowStacking: boolean
  sortOrder: number
  tieredPricingConfig: any
  exclusionGroupKey: string | null
  modifiers: ModifierWithChild[]
}, allGroups: Map<string, typeof group>): object {
  return {
    id: group.id,
    name: group.name,
    displayName: group.displayName,
    minSelections: group.minSelections,
    maxSelections: group.maxSelections,
    isRequired: group.isRequired,
    allowStacking: group.allowStacking,
    tieredPricingConfig: group.tieredPricingConfig,
    exclusionGroupKey: group.exclusionGroupKey,
    sortOrder: group.sortOrder,
    modifiers: group.modifiers.map(m => {
      const childGroup = m.childModifierGroupId ? allGroups.get(m.childModifierGroupId) : null
      return {
        id: m.id,
        name: m.name,
        price: Number(m.price),
        allowNo: m.allowNo,
        allowLite: m.allowLite,
        allowOnSide: m.allowOnSide,
        allowExtra: m.allowExtra,
        extraPrice: Number(m.extraPrice),
        isDefault: m.isDefault,
        sortOrder: m.sortOrder,
        isLabel: m.isLabel ?? false,
        ingredientId: m.ingredientId,
        ingredientName: m.ingredient?.name || null,
        childModifierGroupId: m.childModifierGroupId,
        childModifierGroup: childGroup ? formatModifierGroup(childGroup, allGroups) : null,
      }
    }),
  }
}

// GET /api/menu/items/[id]/modifier-groups - Get item-owned modifier groups with nested children
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: menuItemId } = await params

    const menuItem = await db.menuItem.findUnique({
      where: { id: menuItemId },
      select: { id: true, locationId: true },
    })

    if (!menuItem) {
      return NextResponse.json({ error: 'Menu item not found' }, { status: 404 })
    }

    // Shared include shape for modifiers (used by both queries)
    const modifierInclude = {
      where: { deletedAt: null, isActive: true },
      orderBy: { sortOrder: 'asc' as const },
      include: {
        ingredient: {
          select: { id: true, name: true, category: true },
        },
        childModifierGroup: {
          include: {
            modifiers: {
              where: { deletedAt: null, isActive: true },
              include: {
                ingredient: {
                  select: { id: true, name: true, category: true },
                },
              },
            },
          },
        },
      },
    }

    // 1. Get item-OWNED modifier groups (new pattern — menuItemId set on group)
    const ownedGroups = await db.modifierGroup.findMany({
      where: {
        menuItemId,
        deletedAt: null,
      },
      include: { modifiers: modifierInclude },
      orderBy: { sortOrder: 'asc' },
    })

    // 2. Get SHARED modifier groups via junction table (legacy pattern)
    const sharedLinks = await db.menuItemModifierGroup.findMany({
      where: {
        menuItemId,
        deletedAt: null,
        modifierGroup: { deletedAt: null },
      },
      include: {
        modifierGroup: {
          include: { modifiers: modifierInclude },
        },
      },
      orderBy: { sortOrder: 'asc' },
    })

    // 3. Merge both sources — owned groups first, then shared (no duplicates)
    const ownedIds = new Set(ownedGroups.map(g => g.id))
    const sharedGroups = sharedLinks
      .map(link => link.modifierGroup)
      .filter(g => !ownedIds.has(g.id))

    const allGroups = [...ownedGroups, ...sharedGroups]

    // Build a map of all groups for recursive lookup
    const groupMap = new Map<string, typeof allGroups[0]>()
    allGroups.forEach(g => groupMap.set(g.id, g))

    // Return ALL groups - child groups remain in the list for editing
    // The childModifierGroup reference is just a link, not a move
    return NextResponse.json({
      data: allGroups.map(g => formatModifierGroup(g, groupMap)),
    })
  } catch (error) {
    console.error('Error fetching item modifier groups:', error)
    return NextResponse.json({ error: 'Failed to fetch modifier groups' }, { status: 500 })
  }
}

// POST /api/menu/items/[id]/modifier-groups - Create a new item-owned modifier group
// If parentModifierId is provided, creates as child group and links to that modifier
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: menuItemId } = await params
    const body = await request.json()
    const {
      name,
      minSelections = 0,
      maxSelections = 1,
      isRequired = false,
      templateId, // Optional: copy from template
      parentModifierId, // Optional: create as child group and link to this modifier
      duplicateFromGroupId, // Optional: deep copy existing group
      copyFromItemId, // Optional: source item ID for cross-item copy
    } = body

    if (!name && !duplicateFromGroupId) {
      return NextResponse.json({ error: 'Modifier group name is required' }, { status: 400 })
    }

    const menuItem = await db.menuItem.findUnique({
      where: { id: menuItemId },
      select: { id: true, locationId: true },
    })

    if (!menuItem) {
      return NextResponse.json({ error: 'Menu item not found' }, { status: 404 })
    }

    // If parentModifierId provided, verify it belongs to a group owned by this item
    if (parentModifierId) {
      const parentModifier = await db.modifier.findFirst({
        where: {
          id: parentModifierId,
          modifierGroup: { menuItemId },
        },
      })
      if (!parentModifier) {
        return NextResponse.json({ error: 'Parent modifier not found' }, { status: 404 })
      }
    }

    // Get max sort order
    const maxSort = await db.modifierGroup.aggregate({
      where: { menuItemId },
      _max: { sortOrder: true },
    })

    // If duplicating from existing group
    if (duplicateFromGroupId) {
      // If copying from another item, use copyFromItemId; otherwise use current menuItemId
      const sourceItemId = copyFromItemId || menuItemId

      const sourceGroup = await db.modifierGroup.findFirst({
        where: { id: duplicateFromGroupId, menuItemId: sourceItemId },
        include: {
          modifiers: {
            where: { deletedAt: null },
            orderBy: { sortOrder: 'asc' },
            include: {
              childModifierGroup: {
                include: {
                  modifiers: {
                    where: { deletedAt: null },
                    orderBy: { sortOrder: 'asc' },
                  },
                },
              },
            },
          },
        },
      })

      if (!sourceGroup) {
        return NextResponse.json({ error: 'Source group not found' }, { status: 404 })
      }

      // Deep copy: group + all modifiers + child groups recursively
      const newGroup = await db.$transaction(async (tx) => {
        // Phase 1: Create the parent group (without modifiers)
        const created = await tx.modifierGroup.create({
          data: {
            locationId: menuItem.locationId,
            menuItemId, // ALWAYS assign to the TARGET item
            name: name || `${sourceGroup.name} (Copy)`,
            minSelections: sourceGroup.minSelections,
            maxSelections: sourceGroup.maxSelections,
            isRequired: sourceGroup.isRequired,
            allowStacking: sourceGroup.allowStacking,
            tieredPricingConfig: sourceGroup.tieredPricingConfig ?? Prisma.JsonNull,
            exclusionGroupKey: null, // Don't copy exclusion key — user sets fresh
            sortOrder: (maxSort._max.sortOrder || 0) + 1,
          },
        })

        // Phase 2: Create child groups for modifiers that need them
        const childGroupMap = new Map<string, string>() // old modifier ID -> new child group ID
        let childSortOffset = 0

        for (const mod of sourceGroup.modifiers) {
          if (mod.childModifierGroup) {
            const childGroup = await tx.modifierGroup.create({
              data: {
                locationId: menuItem.locationId,
                menuItemId, // Also owned by the target item
                name: mod.childModifierGroup.name,
                minSelections: mod.childModifierGroup.minSelections,
                maxSelections: mod.childModifierGroup.maxSelections,
                isRequired: mod.childModifierGroup.isRequired,
                allowStacking: mod.childModifierGroup.allowStacking,
                sortOrder: (maxSort._max.sortOrder || 0) + 2 + childSortOffset,
              },
            })
            childGroupMap.set(mod.id, childGroup.id)
            childSortOffset++

            // Create modifiers for the child group
            for (const cm of mod.childModifierGroup.modifiers) {
              await tx.modifier.create({
                data: {
                  locationId: menuItem.locationId,
                  modifierGroupId: childGroup.id,
                  name: cm.name,
                  price: cm.price,
                  allowNo: cm.allowNo,
                  allowLite: cm.allowLite,
                  allowOnSide: cm.allowOnSide,
                  allowExtra: cm.allowExtra,
                  extraPrice: cm.extraPrice,
                  isDefault: cm.isDefault,
                  sortOrder: cm.sortOrder,
                  ingredientId: cm.ingredientId,
                  isLabel: cm.isLabel ?? false,
                },
              })
            }
          }
        }

        // Phase 3: Create all modifiers with their childModifierGroupId links
        for (const mod of sourceGroup.modifiers) {
          await tx.modifier.create({
            data: {
              locationId: menuItem.locationId,
              modifierGroupId: created.id,
              name: mod.name,
              price: mod.price,
              allowNo: mod.allowNo,
              allowLite: mod.allowLite,
              allowOnSide: mod.allowOnSide,
              allowExtra: mod.allowExtra,
              extraPrice: mod.extraPrice,
              isDefault: mod.isDefault,
              sortOrder: mod.sortOrder,
              ingredientId: mod.ingredientId,
              isLabel: mod.isLabel ?? false,
              childModifierGroupId: childGroupMap.get(mod.id) || null,
            },
          })
        }

        // Fetch the created group with modifiers for response
        const groupWithModifiers = await tx.modifierGroup.findUnique({
          where: { id: created.id },
          include: {
            modifiers: {
              where: { deletedAt: null, isActive: true },
              orderBy: { sortOrder: 'asc' },
              include: {
                ingredient: { select: { name: true } },
                childModifierGroup: {
                  include: {
                    modifiers: {
                      where: { deletedAt: null, isActive: true },
                      orderBy: { sortOrder: 'asc' },
                      include: {
                        ingredient: { select: { name: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        })

        return groupWithModifiers!
      })

      // Helper function to format modifier group recursively
      const formatGroup = (group: typeof newGroup): any => ({
        id: group.id,
        name: group.name,
        displayName: group.displayName,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        isRequired: group.isRequired,
        allowStacking: group.allowStacking,
        tieredPricingConfig: group.tieredPricingConfig,
        exclusionGroupKey: group.exclusionGroupKey,
        sortOrder: group.sortOrder,
        modifiers: group.modifiers.map((m: any) => ({
          id: m.id,
          name: m.name,
          price: Number(m.price),
          allowNo: m.allowNo,
          allowLite: m.allowLite,
          allowOnSide: m.allowOnSide,
          allowExtra: m.allowExtra,
          extraPrice: Number(m.extraPrice),
          isDefault: m.isDefault,
          sortOrder: m.sortOrder,
          isLabel: m.isLabel ?? false,
          ingredientId: m.ingredientId,
          ingredientName: m.ingredient?.name || null,
          childModifierGroupId: m.childModifierGroupId,
          childModifierGroup: m.childModifierGroup ? formatGroup(m.childModifierGroup) : null,
        })),
      })

      // Return same format as existing POST response
      return NextResponse.json({
        data: formatGroup(newGroup),
      })
    }

    // If copying from template, get template data
    let templateModifiers: Array<{
      name: string
      price: number
      allowNo: boolean
      allowLite: boolean
      allowOnSide: boolean
      allowExtra: boolean
      extraPrice: number
      isDefault: boolean
      sortOrder: number
    }> = []

    if (templateId) {
      const template = await db.modifierGroupTemplate.findUnique({
        where: { id: templateId },
        include: {
          modifiers: {
            orderBy: { sortOrder: 'asc' },
          },
        },
      })

      if (template) {
        templateModifiers = template.modifiers.map(m => ({
          name: m.name,
          price: Number(m.price),
          allowNo: m.allowNo,
          allowLite: m.allowLite,
          allowOnSide: m.allowOnSide,
          allowExtra: m.allowExtra,
          extraPrice: Number(m.extraPrice),
          isDefault: m.isDefault,
          sortOrder: m.sortOrder,
        }))
      }
    }

    // Use transaction if we need to link to parent modifier
    const group = await db.$transaction(async (tx) => {
      // Create the modifier group owned by this item
      const newGroup = await tx.modifierGroup.create({
        data: {
          locationId: menuItem.locationId,
          menuItemId, // This makes it item-specific!
          name: name || 'New Group',
          minSelections,
          maxSelections,
          isRequired,
          sortOrder: (maxSort._max.sortOrder || 0) + 1,
          // Create modifiers from template if provided
          modifiers: templateModifiers.length > 0
            ? {
                create: templateModifiers.map(m => ({
                  locationId: menuItem.locationId,
                  name: m.name,
                  price: m.price,
                  allowNo: m.allowNo,
                  allowLite: m.allowLite,
                  allowOnSide: m.allowOnSide,
                  allowExtra: m.allowExtra,
                  extraPrice: m.extraPrice,
                  isDefault: m.isDefault,
                  sortOrder: m.sortOrder,
                })),
              }
            : undefined,
        },
        include: {
          modifiers: {
            where: { deletedAt: null },
            orderBy: { sortOrder: 'asc' },
          },
        },
      })

      // If this is a child group, link it to the parent modifier
      if (parentModifierId) {
        await tx.modifier.update({
          where: { id: parentModifierId },
          data: { childModifierGroupId: newGroup.id },
        })
      }

      return newGroup
    })

    return NextResponse.json({
      data: {
        id: group.id,
        name: group.name,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        isRequired: group.isRequired,
        allowStacking: group.allowStacking,
        tieredPricingConfig: group.tieredPricingConfig,
        exclusionGroupKey: group.exclusionGroupKey,
        sortOrder: group.sortOrder,
        modifiers: group.modifiers.map(m => ({
          id: m.id,
          name: m.name,
          price: Number(m.price),
          allowNo: m.allowNo,
          allowLite: m.allowLite,
          allowOnSide: m.allowOnSide,
          allowExtra: m.allowExtra,
          extraPrice: Number(m.extraPrice),
          isDefault: m.isDefault,
          sortOrder: m.sortOrder,
          isLabel: m.isLabel ?? false,
        })),
      },
    })
  } catch (error) {
    console.error('Error creating modifier group:', error)
    return NextResponse.json({ error: 'Failed to create modifier group' }, { status: 500 })
  }
}

// PATCH /api/menu/items/[id]/modifier-groups - Bulk update sort orders
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: menuItemId } = await params
    const body = await request.json()
    const { sortOrders } = body // Array of { id: string, sortOrder: number }

    if (!Array.isArray(sortOrders) || sortOrders.length === 0) {
      return NextResponse.json({ error: 'sortOrders array is required' }, { status: 400 })
    }

    // Validate each entry
    for (const entry of sortOrders) {
      if (!entry.id || typeof entry.sortOrder !== 'number' || !Number.isFinite(entry.sortOrder)) {
        return NextResponse.json({ error: 'Each sortOrder entry must have a valid id and numeric sortOrder' }, { status: 400 })
      }
    }

    // Verify all groups belong to this item
    const groups = await db.modifierGroup.findMany({
      where: { menuItemId, id: { in: sortOrders.map(s => s.id) } },
      select: { id: true },
    })

    if (groups.length !== sortOrders.length) {
      return NextResponse.json({ error: 'Some groups not found' }, { status: 404 })
    }

    // Bulk update in transaction
    await db.$transaction(
      sortOrders.map(({ id, sortOrder }) =>
        db.modifierGroup.update({
          where: { id },
          data: { sortOrder },
        })
      )
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating modifier group sort orders:', error)
    return NextResponse.json({ error: 'Failed to update sort orders' }, { status: 500 })
  }
}
