import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'

// GET - List all combos
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    // Get all combo menu items with their templates
    const combos = await prisma.menuItem.findMany({
      where: {
        locationId,
        itemType: 'combo',
      },
      include: {
        category: {
          select: { id: true, name: true },
        },
      },
      orderBy: { name: 'asc' },
    })

    // Get combo templates for these items
    const comboTemplates = await prisma.comboTemplate.findMany({
      where: {
        menuItemId: { in: combos.map(c => c.id) },
      },
      include: {
        components: {
          include: {
            menuItem: {
              select: {
                id: true,
                name: true,
                price: true,
              },
            },
            options: {
              orderBy: { sortOrder: 'asc' },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    // Get menu item modifier groups for each combo component's menuItem
    const componentMenuItemIds = comboTemplates.flatMap(t =>
      t.components.filter(c => c.menuItemId).map(c => c.menuItemId!)
    )

    const menuItemModifierGroups = await prisma.menuItemModifierGroup.findMany({
      where: { menuItemId: { in: componentMenuItemIds } },
      include: {
        modifierGroup: {
          include: {
            modifiers: {
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    })

    // Build a map of menuItemId -> modifierGroups
    const itemModifierMap: Record<string, typeof menuItemModifierGroups> = {}
    for (const mimg of menuItemModifierGroups) {
      if (!itemModifierMap[mimg.menuItemId]) {
        itemModifierMap[mimg.menuItemId] = []
      }
      itemModifierMap[mimg.menuItemId].push(mimg)
    }

    // Build template map
    const templateMap = Object.fromEntries(
      comboTemplates.map(t => [t.menuItemId, {
        id: t.id,
        basePrice: Number(t.basePrice),
        comparePrice: t.comparePrice ? Number(t.comparePrice) : null,
        components: t.components.map(c => ({
          id: c.id,
          slotName: c.slotName,
          displayName: c.displayName,
          sortOrder: c.sortOrder,
          isRequired: c.isRequired,
          minSelections: c.minSelections,
          maxSelections: c.maxSelections,
          menuItemId: c.menuItemId,
          menuItem: c.menuItem ? {
            id: c.menuItem.id,
            name: c.menuItem.name,
            price: Number(c.menuItem.price),
            modifierGroups: (itemModifierMap[c.menuItem.id] || []).map(mimg => ({
              modifierGroup: {
                id: mimg.modifierGroup.id,
                name: mimg.modifierGroup.name,
                displayName: mimg.modifierGroup.displayName,
                minSelections: mimg.modifierGroup.minSelections,
                maxSelections: mimg.modifierGroup.maxSelections,
                isRequired: mimg.modifierGroup.isRequired,
                modifiers: mimg.modifierGroup.modifiers.map(m => ({
                  id: m.id,
                  name: m.name,
                  price: Number(m.price),
                  childModifierGroupId: m.childModifierGroupId,
                })),
              },
            })),
          } : null,
          itemPriceOverride: c.itemPriceOverride ? Number(c.itemPriceOverride) : null,
          modifierPriceOverrides: c.modifierPriceOverrides as Record<string, number> | null,
        })),
      }])
    )

    return NextResponse.json({
      combos: combos.map(c => ({
        id: c.id,
        name: c.name,
        displayName: c.displayName,
        description: c.description,
        price: Number(c.price),
        categoryId: c.categoryId,
        categoryName: c.category.name,
        isActive: c.isActive,
        isAvailable: c.isAvailable,
        template: templateMap[c.id] || null,
      })),
    })
  } catch (error) {
    console.error('Get combos error:', error)
    return NextResponse.json({ error: 'Failed to fetch combos' }, { status: 500 })
  }
}

// POST - Create a new combo
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      categoryId,
      name,
      displayName,
      description,
      price,
      comparePrice,
      isActive = true,
      components = [],
    } = body

    if (!locationId || !categoryId || !name || price === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Create the menu item as a combo
    const menuItem = await prisma.menuItem.create({
      data: {
        locationId,
        categoryId,
        name,
        displayName,
        description,
        price,
        itemType: 'combo',
        isActive,
      },
    })

    // Create the combo template
    const template = await prisma.comboTemplate.create({
      data: {
        locationId,
        menuItemId: menuItem.id,
        basePrice: price,
        comparePrice,
        components: {
          create: components.map((comp: {
            slotName: string
            displayName: string
            sortOrder?: number
            isRequired?: boolean
            minSelections?: number
            maxSelections?: number
            menuItemId?: string
            itemPriceOverride?: number
            modifierPriceOverrides?: Record<string, number>
          }, idx: number) => ({
            locationId,
            slotName: comp.slotName,
            displayName: comp.displayName,
            sortOrder: comp.sortOrder ?? idx,
            isRequired: comp.isRequired ?? true,
            minSelections: comp.minSelections ?? 1,
            maxSelections: comp.maxSelections ?? 1,
            menuItemId: comp.menuItemId || null,
            itemPriceOverride: comp.itemPriceOverride ?? null,
            modifierPriceOverrides: comp.modifierPriceOverrides || null,
          })),
        },
      },
      include: {
        components: true,
      },
    })

    return NextResponse.json({
      combo: {
        id: menuItem.id,
        name: menuItem.name,
        price: Number(menuItem.price),
        template: {
          id: template.id,
          basePrice: Number(template.basePrice),
          comparePrice: template.comparePrice ? Number(template.comparePrice) : null,
          components: template.components,
        },
      },
    })
  } catch (error) {
    console.error('Create combo error:', error)
    return NextResponse.json({ error: 'Failed to create combo' }, { status: 500 })
  }
}
