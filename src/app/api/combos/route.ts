import { NextRequest } from 'next/server'
import { db as prisma } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, ok } from '@/lib/api-response'

// GET - List all combos
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return err('Location ID required')
    }

    // Get all combo menu items with their templates
    const combos = await prisma.menuItem.findMany({
      where: {
        locationId,
        itemType: 'combo',
        deletedAt: null,
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
        deletedAt: null,
      },
      include: {
        components: {
          where: { deletedAt: null },
          include: {
            menuItem: {
              select: {
                id: true,
                name: true,
                price: true,
                isAvailable: true,
                isActive: true,
              },
            },
            options: {
              where: { deletedAt: null },
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

    const ownedModifierGroups = await prisma.modifierGroup.findMany({
      where: { menuItemId: { in: componentMenuItemIds }, deletedAt: null },
      include: {
        modifiers: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    // Build a map of menuItemId -> modifierGroups
    const itemModifierMap: Record<string, typeof ownedModifierGroups> = {}
    for (const mg of ownedModifierGroups) {
      if (!mg.menuItemId) continue
      if (!itemModifierMap[mg.menuItemId]) {
        itemModifierMap[mg.menuItemId] = []
      }
      itemModifierMap[mg.menuItemId].push(mg)
    }

    // Collect menu item IDs referenced by options so we can attach names/prices
    const optionMenuItemIds = Array.from(new Set(
      comboTemplates.flatMap(t => t.components.flatMap(c => c.options.map(o => o.menuItemId)))
    ))
    const optionMenuItems = optionMenuItemIds.length > 0
      ? await prisma.menuItem.findMany({
          where: { id: { in: optionMenuItemIds } },
          select: { id: true, name: true, price: true },
        })
      : []
    const optionMenuItemMap = Object.fromEntries(
      optionMenuItems.map(mi => [mi.id, { name: mi.name, price: Number(mi.price) }])
    )

    // Build template map
    const templateMap = Object.fromEntries(
      comboTemplates.map(t => [t.menuItemId, {
        id: t.id,
        basePrice: Number(t.basePrice),
        comparePrice: t.comparePrice ? Number(t.comparePrice) : null,
        allowUpcharges: t.allowUpcharges,
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
            isAvailable: c.menuItem.isAvailable,
            isActive: c.menuItem.isActive,
            modifierGroups: (itemModifierMap[c.menuItem.id] || []).map(mg => ({
              modifierGroup: {
                id: mg.id,
                name: mg.name,
                displayName: mg.displayName,
                minSelections: mg.minSelections,
                maxSelections: mg.maxSelections,
                isRequired: mg.isRequired,
                modifiers: mg.modifiers.map(m => ({
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
          options: c.options.map(o => ({
            id: o.id,
            menuItemId: o.menuItemId,
            name: optionMenuItemMap[o.menuItemId]?.name ?? '',
            price: optionMenuItemMap[o.menuItemId]?.price ?? 0,
            upcharge: Number(o.upcharge),
            sortOrder: o.sortOrder,
            isAvailable: o.isAvailable,
          })),
        })),
      }])
    )

    return ok({
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
    return err('Failed to fetch combos', 500)
  }
})

// Input shape for component options on create/update
type OptionInput = {
  id?: string
  menuItemId: string
  upcharge?: number
  sortOrder?: number
  isAvailable?: boolean
}

type ComponentInput = {
  id?: string
  slotName: string
  displayName: string
  sortOrder?: number
  isRequired?: boolean
  minSelections?: number
  maxSelections?: number
  menuItemId?: string | null
  itemPriceOverride?: number | null
  modifierPriceOverrides?: Record<string, number> | null
  options?: OptionInput[]
}

// POST - Create a new combo
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
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
      allowUpcharges = false,
      components = [],
    } = body as {
      locationId?: string
      categoryId?: string
      name?: string
      displayName?: string
      description?: string
      price?: number
      comparePrice?: number | null
      isActive?: boolean
      allowUpcharges?: boolean
      components?: ComponentInput[]
    }

    if (!locationId || !categoryId || !name || price === undefined) {
      return err('Missing required fields')
    }

    // Create menu item + template + components + options in a single transaction.
    const result = await prisma.$transaction(async (tx) => {
      const menuItem = await tx.menuItem.create({
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

      const template = await tx.comboTemplate.create({
        data: {
          locationId,
          menuItemId: menuItem.id,
          basePrice: price,
          comparePrice: comparePrice ?? null,
          allowUpcharges: !!allowUpcharges,
        },
      })

      // Create components one-by-one so we have the component id for option inserts.
      for (let idx = 0; idx < (components?.length ?? 0); idx++) {
        const comp = components![idx]
        const createdComp = await tx.comboComponent.create({
          data: {
            ...(comp.id ? { id: comp.id } : {}),
            locationId,
            comboTemplateId: template.id,
            slotName: comp.slotName,
            displayName: comp.displayName,
            sortOrder: comp.sortOrder ?? idx,
            isRequired: comp.isRequired ?? true,
            minSelections: comp.minSelections ?? 1,
            maxSelections: comp.maxSelections ?? 1,
            menuItemId: comp.menuItemId || null,
            itemPriceOverride: comp.itemPriceOverride ?? null,
            modifierPriceOverrides: comp.modifierPriceOverrides || undefined,
          },
        })

        const opts = comp.options ?? []
        for (let optIdx = 0; optIdx < opts.length; optIdx++) {
          const opt = opts[optIdx]
          if (!opt.menuItemId) continue
          await tx.comboComponentOption.create({
            data: {
              ...(opt.id ? { id: opt.id } : {}),
              locationId,
              comboComponentId: createdComp.id,
              menuItemId: opt.menuItemId,
              upcharge: opt.upcharge ?? 0,
              sortOrder: opt.sortOrder ?? optIdx,
              isAvailable: opt.isAvailable ?? true,
            },
          })
        }
      }

      return { menuItem, template }
    })

    void notifyDataChanged({ locationId, domain: 'combos', action: 'created', entityId: result.menuItem.id })
    void pushUpstream()

    return ok({
      combo: {
        id: result.menuItem.id,
        name: result.menuItem.name,
        price: Number(result.menuItem.price),
        template: {
          id: result.template.id,
          basePrice: Number(result.template.basePrice),
          comparePrice: result.template.comparePrice ? Number(result.template.comparePrice) : null,
          allowUpcharges: result.template.allowUpcharges,
        },
      },
    })
  } catch (error) {
    console.error('Create combo error:', error)
    return err('Failed to create combo', 500)
  }
}))
