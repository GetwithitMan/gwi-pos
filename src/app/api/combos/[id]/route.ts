import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Find the combo template for this menu item
    const template = await db.comboTemplate.findFirst({
      where: { menuItemId: id, deletedAt: null },
      include: {
        components: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
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
              include: {
                menuItem: {
                  select: { id: true, name: true, price: true, isAvailable: true, isActive: true }
                }
              }
            },
          }
        }
      }
    })

    if (!template) {
      return ok({
        template: null,
        message: 'No combo template found for this item'
      })
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

    return ok({
      template: {
        id: template.id,
        basePrice: Number(template.basePrice),
        comparePrice: template.comparePrice ? Number(template.comparePrice) : null,
        allowUpcharges: template.allowUpcharges,
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
    })
  } catch (error) {
    console.error('Failed to fetch combo:', error)
    return err('Failed to fetch combo', 500)
  }
})

// Input shapes for PUT (mirror POST)
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

// PUT - Update combo (stable-id diff, no delete-recreate)
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
      allowUpcharges,
      components,
      requestingEmployeeId,
    } = body as {
      name?: string
      displayName?: string
      description?: string
      price?: number
      comparePrice?: number | null
      categoryId?: string
      isActive?: boolean
      allowUpcharges?: boolean
      components?: ComponentInput[]
      requestingEmployeeId?: string
    }

    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = requestingEmployeeId ?? actor.employeeId

    // Verify menu item exists to get locationId for auth
    const existing = await db.menuItem.findUnique({ where: { id }, select: { locationId: true } })
    if (!existing) {
      return notFound('Combo not found')
    }

    const auth = await requirePermission(resolvedEmployeeId, existing.locationId, PERMISSIONS.MENU_EDIT_ITEMS)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    const locationId = existing.locationId

    const menuItem = await db.$transaction(async (tx) => {
      // Update the menu item
      const updateData: Record<string, unknown> = {}
      if (name !== undefined) updateData.name = name
      if (displayName !== undefined) updateData.displayName = displayName
      if (description !== undefined) updateData.description = description
      if (price !== undefined) updateData.price = price
      if (categoryId !== undefined) updateData.categoryId = categoryId
      if (isActive !== undefined) updateData.isActive = isActive

      const updatedMenuItem = await tx.menuItem.update({
        where: { id },
        data: updateData,
      })

      // Update template-level fields if any provided
      if (price !== undefined || comparePrice !== undefined || allowUpcharges !== undefined) {
        await tx.comboTemplate.updateMany({
          where: { menuItemId: id, deletedAt: null },
          data: {
            ...(price !== undefined && { basePrice: price }),
            ...(comparePrice !== undefined && { comparePrice: comparePrice ?? null }),
            ...(allowUpcharges !== undefined && { allowUpcharges: !!allowUpcharges }),
          },
        })
      }

      // If components provided, diff-update them (stable ids, soft-delete removed)
      if (components !== undefined) {
        const existingTemplate = await tx.comboTemplate.findFirst({
          where: { menuItemId: id, deletedAt: null },
          include: {
            components: {
              where: { deletedAt: null },
              include: {
                options: { where: { deletedAt: null } },
              },
            },
          },
        })

        if (existingTemplate) {
          const incomingComponentIds = new Set(
            components.filter(c => !!c.id).map(c => c.id as string)
          )

          // Soft-delete components (and their options) that no longer appear in payload
          const removedComponents = existingTemplate.components.filter(
            ec => !incomingComponentIds.has(ec.id)
          )
          if (removedComponents.length > 0) {
            const removedIds = removedComponents.map(c => c.id)
            await tx.comboComponentOption.updateMany({
              where: { comboComponentId: { in: removedIds }, deletedAt: null },
              data: { deletedAt: new Date() },
            })
            await tx.comboComponent.updateMany({
              where: { id: { in: removedIds }, deletedAt: null },
              data: { deletedAt: new Date() },
            })
          }

          const existingCompById = new Map(
            existingTemplate.components.map(c => [c.id, c])
          )

          // Upsert components (in submitted order)
          for (let idx = 0; idx < components.length; idx++) {
            const comp = components[idx]
            const compData = {
              slotName: comp.slotName,
              displayName: comp.displayName,
              sortOrder: comp.sortOrder ?? idx,
              isRequired: comp.isRequired ?? true,
              minSelections: comp.minSelections ?? 1,
              maxSelections: comp.maxSelections ?? 1,
              menuItemId: comp.menuItemId || null,
              itemPriceOverride: comp.itemPriceOverride ?? null,
              modifierPriceOverrides: comp.modifierPriceOverrides ?? undefined,
            }

            let componentId: string
            if (comp.id && existingCompById.has(comp.id)) {
              // Update in place
              await tx.comboComponent.update({
                where: { id: comp.id },
                data: compData,
              })
              componentId = comp.id
            } else {
              // Insert — honor client-supplied id when provided
              const created = await tx.comboComponent.create({
                data: {
                  ...(comp.id ? { id: comp.id } : {}),
                  locationId,
                  comboTemplateId: existingTemplate.id,
                  ...compData,
                },
              })
              componentId = created.id
            }

            // Diff options for this component
            const existingOptions = existingCompById.get(componentId)?.options ?? []
            const existingOptionById = new Map(existingOptions.map(o => [o.id, o]))
            const incomingOptions = comp.options ?? []
            const incomingOptionIds = new Set(
              incomingOptions.filter(o => !!o.id).map(o => o.id as string)
            )

            // Soft-delete removed options
            const removedOptionIds = existingOptions
              .filter(eo => !incomingOptionIds.has(eo.id))
              .map(eo => eo.id)
            if (removedOptionIds.length > 0) {
              await tx.comboComponentOption.updateMany({
                where: { id: { in: removedOptionIds }, deletedAt: null },
                data: { deletedAt: new Date() },
              })
            }

            // Upsert incoming options
            for (let optIdx = 0; optIdx < incomingOptions.length; optIdx++) {
              const opt = incomingOptions[optIdx]
              if (!opt.menuItemId) continue
              const optData = {
                menuItemId: opt.menuItemId,
                upcharge: opt.upcharge ?? 0,
                sortOrder: opt.sortOrder ?? optIdx,
                isAvailable: opt.isAvailable ?? true,
              }

              if (opt.id && existingOptionById.has(opt.id)) {
                await tx.comboComponentOption.update({
                  where: { id: opt.id },
                  data: optData,
                })
              } else {
                await tx.comboComponentOption.create({
                  data: {
                    ...(opt.id ? { id: opt.id } : {}),
                    locationId,
                    comboComponentId: componentId,
                    ...optData,
                  },
                })
              }
            }
          }
        }
      }

      return updatedMenuItem
    })

    void notifyDataChanged({ locationId, domain: 'combos', action: 'updated', entityId: id })
    void pushUpstream()

    return ok({
      combo: {
        id: menuItem.id,
        name: menuItem.name,
        price: Number(menuItem.price),
      },
    })
  } catch (error) {
    console.error('Failed to update combo:', error)
    return err('Failed to update combo', 500)
  }
})

// DELETE - Delete combo
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = request.nextUrl.searchParams.get('requestingEmployeeId') ?? actor.employeeId

    // Verify menu item exists to get locationId for auth
    const menuItemCheck = await db.menuItem.findUnique({ where: { id }, select: { locationId: true } })
    if (!menuItemCheck) {
      return notFound('Combo not found')
    }

    const auth = await requirePermission(resolvedEmployeeId, menuItemCheck.locationId, PERMISSIONS.MENU_EDIT_ITEMS)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

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

    void notifyDataChanged({ locationId: menuItemCheck.locationId, domain: 'combos', action: 'deleted', entityId: id })
    void pushUpstream()

    return ok({ success: true })
  } catch (error) {
    console.error('Failed to delete combo:', error)
    return err('Failed to delete combo', 500)
  }
})
