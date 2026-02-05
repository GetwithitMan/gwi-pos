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
    } = body

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
        })),
      },
    })
  } catch (error) {
    console.error('Error creating modifier group:', error)
    return NextResponse.json({ error: 'Failed to create modifier group' }, { status: 500 })
  }
}
