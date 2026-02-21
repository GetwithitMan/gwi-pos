import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Find the combo template for this menu item
    const template = await db.comboTemplate.findFirst({
      where: { menuItemId: id },
      include: {
        components: {
          orderBy: { sortOrder: 'asc' },
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
              include: {
                menuItem: {
                  select: { id: true, name: true, price: true }
                }
              }
            },
          }
        }
      }
    })

    if (!template) {
      return NextResponse.json({ data: {
        template: null,
        message: 'No combo template found for this item'
      } })
    }

    // Get modifier groups for each component's menu item
    const componentMenuItemIds = template.components
      .filter(c => c.menuItemId)
      .map(c => c.menuItemId!)

    const ownedModifierGroups = await db.modifierGroup.findMany({
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

    return NextResponse.json({ data: {
      template: {
        id: template.id,
        basePrice: Number(template.basePrice),
        comparePrice: template.comparePrice ? Number(template.comparePrice) : null,
        components: template.components.map(c => ({
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
          // Legacy options support
          options: c.options.map(o => ({
            id: o.id,
            menuItemId: o.menuItemId,
            name: o.menuItem.name,
            price: Number(o.menuItem.price),
            upcharge: Number(o.upcharge),
            sortOrder: o.sortOrder,
            isAvailable: o.isAvailable,
          }))
        }))
      }
    } })
  } catch (error) {
    console.error('Failed to fetch combo:', error)
    return NextResponse.json(
      { error: 'Failed to fetch combo' },
      { status: 500 }
    )
  }
})

// PUT - Update combo
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const {
      name,
      displayName,
      description,
      price,
      comparePrice,
      categoryId,
      isActive,
      components,
    } = body

    // Update the menu item
    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (displayName !== undefined) updateData.displayName = displayName
    if (description !== undefined) updateData.description = description
    if (price !== undefined) updateData.price = price
    if (categoryId !== undefined) updateData.categoryId = categoryId
    if (isActive !== undefined) updateData.isActive = isActive

    const menuItem = await db.menuItem.update({
      where: { id },
      data: updateData,
    })

    // Update template if price or comparePrice changed
    if (price !== undefined || comparePrice !== undefined) {
      await db.comboTemplate.updateMany({
        where: { menuItemId: id },
        data: {
          ...(price !== undefined && { basePrice: price }),
          ...(comparePrice !== undefined && { comparePrice }),
        },
      })
    }

    // If components provided, rebuild them
    if (components !== undefined) {
      // Find existing template
      const existingTemplate = await db.comboTemplate.findFirst({
        where: { menuItemId: id },
      })

      if (existingTemplate) {
        // Delete existing components and options
        const existingComponents = await db.comboComponent.findMany({
          where: { comboTemplateId: existingTemplate.id },
        })

        await db.comboComponentOption.deleteMany({
          where: { comboComponentId: { in: existingComponents.map(c => c.id) } },
        })

        await db.comboComponent.deleteMany({
          where: { comboTemplateId: existingTemplate.id },
        })

        // Create new components
        for (let idx = 0; idx < components.length; idx++) {
          const comp = components[idx]
          await db.comboComponent.create({
            data: {
              locationId: menuItem.locationId,
              comboTemplateId: existingTemplate.id,
              slotName: comp.slotName,
              displayName: comp.displayName,
              sortOrder: comp.sortOrder ?? idx,
              isRequired: comp.isRequired ?? true,
              minSelections: comp.minSelections ?? 1,
              maxSelections: comp.maxSelections ?? 1,
              menuItemId: comp.menuItemId || null,
              itemPriceOverride: comp.itemPriceOverride ?? null,
              modifierPriceOverrides: comp.modifierPriceOverrides || null,
            },
          })
        }
      }
    }

    return NextResponse.json({ data: {
      combo: {
        id: menuItem.id,
        name: menuItem.name,
        price: Number(menuItem.price),
      },
    } })
  } catch (error) {
    console.error('Failed to update combo:', error)
    return NextResponse.json(
      { error: 'Failed to update combo' },
      { status: 500 }
    )
  }
})

// DELETE - Delete combo
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Find and delete the template first (cascades to components and options)
    const template = await db.comboTemplate.findFirst({
      where: { menuItemId: id },
      include: { components: true },
    })

    if (template) {
      // Soft delete options
      await db.comboComponentOption.updateMany({
        where: { comboComponentId: { in: template.components.map(c => c.id) } },
        data: { deletedAt: new Date() },
      })

      // Soft delete components
      await db.comboComponent.updateMany({
        where: { comboTemplateId: template.id },
        data: { deletedAt: new Date() },
      })

      // Soft delete template
      await db.comboTemplate.update({
        where: { id: template.id },
        data: { deletedAt: new Date() },
      })
    }

    // Soft delete the menu item
    await db.menuItem.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete combo:', error)
    return NextResponse.json(
      { error: 'Failed to delete combo' },
      { status: 500 }
    )
  }
})
