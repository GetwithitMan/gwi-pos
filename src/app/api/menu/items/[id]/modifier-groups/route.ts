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
// orphanedModifierIds collects modifier IDs whose childModifierGroupId points to a missing group
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
}, allGroups: Map<string, typeof group>, orphanedModifierIds?: string[]): object {
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
      // If childModifierGroupId is set but the group is missing/deleted, treat as orphan
      const isOrphaned = !!m.childModifierGroupId && !childGroup
      if (isOrphaned && orphanedModifierIds) {
        orphanedModifierIds.push(m.id)
      }
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
        // Clear orphaned references — return null if child group doesn't exist
        childModifierGroupId: isOrphaned ? null : m.childModifierGroupId,
        childModifierGroup: childGroup ? formatModifierGroup(childGroup, allGroups, orphanedModifierIds) : null,
        printerRouting: m.printerRouting,
        printerIds: m.printerIds,
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

    // Get item-OWNED modifier groups only (menuItemId set on group)
    // Legacy shared groups via MenuItemModifierGroup junction table are no longer returned
    const allGroups = await db.modifierGroup.findMany({
      where: {
        menuItemId,
        deletedAt: null,
      },
      include: { modifiers: modifierInclude },
      orderBy: { sortOrder: 'asc' },
    })

    // Build a map of all groups for recursive lookup
    const groupMap = new Map<string, typeof allGroups[0]>()
    allGroups.forEach(g => groupMap.set(g.id, g))

    // Format all groups, collecting any orphaned modifier IDs for cleanup
    const orphanedModifierIds: string[] = []
    const formattedGroups = allGroups.map(g => formatModifierGroup(g, groupMap, orphanedModifierIds))

    // Auto-fix orphaned childModifierGroupId references in the background
    if (orphanedModifierIds.length > 0) {
      db.modifier.updateMany({
        where: { id: { in: orphanedModifierIds } },
        data: { childModifierGroupId: null },
      }).catch(err => console.error('Failed to clean up orphaned childModifierGroupId refs:', err))
    }

    // Return ALL groups - child groups remain in the list for editing
    // The childModifierGroup reference is just a link, not a move
    return NextResponse.json({
      data: formattedGroups,
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

    const groupIds = sortOrders.map(s => s.id)

    // Verify all groups belong to this item (owned groups only)
    const ownedGroups = await db.modifierGroup.findMany({
      where: { menuItemId, id: { in: groupIds }, deletedAt: null },
      select: { id: true },
    })

    if (ownedGroups.length !== sortOrders.length) {
      return NextResponse.json({ error: 'Some groups not found for this item' }, { status: 404 })
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

// POST /api/menu/items/[id]/modifier-groups/reparent - Move a group to a different hierarchy level
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: menuItemId } = await params
    const body = await request.json()
    const { groupId, targetParentModifierId } = body
    // targetParentModifierId: null = promote to top-level, string = demote to child of this modifier

    if (!groupId) {
      return NextResponse.json({ error: 'groupId is required' }, { status: 400 })
    }

    // Verify the group belongs to this item
    const group = await db.modifierGroup.findFirst({
      where: { id: groupId, menuItemId },
    })

    if (!group) {
      return NextResponse.json({ error: 'Group not found for this item' }, { status: 404 })
    }

    // Find the current parent modifier (if any) that links to this group
    const currentParentModifier = await db.modifier.findFirst({
      where: {
        childModifierGroupId: groupId,
        deletedAt: null,
      },
      select: { id: true, modifierGroupId: true },
    })

    await db.$transaction(async (tx) => {
      // Step 1: Unlink from current parent (if it has one)
      if (currentParentModifier) {
        await tx.modifier.update({
          where: { id: currentParentModifier.id },
          data: { childModifierGroupId: null },
        })
      }

      // Step 2: Link to new parent (if demoting to child)
      if (targetParentModifierId) {
        // Verify target modifier belongs to a group owned by this item
        const targetMod = await tx.modifier.findFirst({
          where: {
            id: targetParentModifierId,
            modifierGroup: { menuItemId },
            deletedAt: null,
          },
        })

        if (!targetMod) {
          throw new Error('Target modifier not found for this item')
        }

        // Prevent cycles: the target modifier cannot be inside the group we're moving
        // (i.e., don't let a group become a child of its own descendant)
        const isDescendant = await checkIsDescendant(tx, groupId, targetMod.modifierGroupId)
        if (isDescendant) {
          throw new Error('Cannot move a group into its own descendant (would create cycle)')
        }

        await tx.modifier.update({
          where: { id: targetParentModifierId },
          data: { childModifierGroupId: groupId },
        })
      }
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error reparenting modifier group:', error)
    const message = error?.message || 'Failed to reparent modifier group'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Helper: Check if potentialDescendantGroupId is a descendant of ancestorGroupId
async function checkIsDescendant(tx: any, ancestorGroupId: string, potentialDescendantGroupId: string, visited = new Set<string>()): Promise<boolean> {
  if (ancestorGroupId === potentialDescendantGroupId) return true
  if (visited.has(ancestorGroupId)) return false
  visited.add(ancestorGroupId)

  // Get all modifiers in the ancestor group that have child groups
  const modifiers = await tx.modifier.findMany({
    where: {
      modifierGroupId: ancestorGroupId,
      childModifierGroupId: { not: null },
      deletedAt: null,
    },
    select: { childModifierGroupId: true },
  })

  for (const mod of modifiers) {
    if (mod.childModifierGroupId === potentialDescendantGroupId) return true
    const found = await checkIsDescendant(tx, mod.childModifierGroupId!, potentialDescendantGroupId, visited)
    if (found) return true
  }

  return false
}
