import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { getActorFromRequest, requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

interface RouteParams {
  params: Promise<{ id: string }>
}

const ALLOWED_MODIFIER_TYPES = ['food', 'liquor', 'universal'] as const

function normalizeModifierTypes(types: unknown): string[] {
  if (!Array.isArray(types)) return ['food']
  const valid = types
    .filter((t): t is string => typeof t === 'string' && ALLOWED_MODIFIER_TYPES.includes(t as any))
    .filter((t, i, arr) => arr.indexOf(t) === i)
  if (valid.length === 0) return ['food']
  return valid.sort()
}

function formatTemplate(t: any) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    minSelections: t.minSelections,
    maxSelections: t.maxSelections,
    isRequired: t.isRequired,
    allowStacking: t.allowStacking ?? false,
    modifierTypes: t.modifierTypes ?? ['food'],
    sortOrder: t.sortOrder,
    isActive: t.isActive,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    modifiers: (t.modifiers || []).map((m: any) => ({
      id: m.id,
      name: m.name,
      displayName: m.displayName ?? null,
      price: Number(m.price),
      allowNo: m.allowNo,
      allowLite: m.allowLite,
      allowOnSide: m.allowOnSide,
      allowExtra: m.allowExtra,
      extraPrice: Number(m.extraPrice),
      sortOrder: m.sortOrder,
      isDefault: m.isDefault,
      ingredientId: m.ingredientId ?? null,
      ingredientName: m.ingredientName ?? null,
      inventoryDeductionAmount: m.inventoryDeductionAmount ? Number(m.inventoryDeductionAmount) : null,
      inventoryDeductionUnit: m.inventoryDeductionUnit ?? null,
      showOnPOS: m.showOnPOS ?? true,
      showOnline: m.showOnline ?? true,
    })),
  }
}

// GET /api/menu/modifier-templates/[id] — get single template with modifiers
export const GET = withVenue(async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const template = await db.modifierGroupTemplate.findFirst({
      where: { id, locationId, deletedAt: null },
      include: {
        modifiers: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    if (!template) {
      return notFound('Template not found')
    }

    return ok(formatTemplate(template))
  } catch (error) {
    console.error('Error fetching modifier template:', error)
    return err('Failed to fetch template', 500)
  }
})

// PUT /api/menu/modifier-templates/[id] — full replace template + modifiers
export const PUT = withVenue(async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Auth check — require menu.edit_items permission
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.MENU_EDIT_ITEMS)
    if (!auth.authorized) return err(auth.error, auth.status)

    const existing = await db.modifierGroupTemplate.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!existing) {
      return notFound('Template not found')
    }

    const body = await request.json()
    const {
      name,
      description,
      minSelections,
      maxSelections,
      isRequired,
      allowStacking,
      modifierTypes: rawModifierTypes,
      modifiers: bodyModifiers,
    } = body

    // Check for duplicate name (if name is changing)
    if (name && name !== existing.name) {
      const duplicate = await db.modifierGroupTemplate.findUnique({
        where: { locationId_name: { locationId, name } },
      })
      if (duplicate && !duplicate.deletedAt) {
        return err('A template with this name already exists', 409)
      }
    }

    const template = await db.$transaction(async (tx) => {
      // Delete all existing modifier templates
      await tx.modifierTemplate.deleteMany({
        where: { templateId: id },
      })

      // Update template + create new modifiers
      return tx.modifierGroupTemplate.update({
        where: { id },
        data: {
          name: name ?? existing.name,
          description: description !== undefined ? description : existing.description,
          minSelections: minSelections ?? existing.minSelections,
          maxSelections: maxSelections ?? existing.maxSelections,
          isRequired: isRequired ?? existing.isRequired,
          allowStacking: allowStacking ?? existing.allowStacking,
          modifierTypes: rawModifierTypes ? normalizeModifierTypes(rawModifierTypes) : undefined,
          modifiers: Array.isArray(bodyModifiers)
            ? {
                create: bodyModifiers.map((m: any, i: number) => ({
                  locationId,
                  name: m.name || `Modifier ${i + 1}`,
                  displayName: m.displayName || null,
                  price: m.price ?? 0,
                  allowNo: m.allowNo ?? true,
                  allowLite: m.allowLite ?? false,
                  allowOnSide: m.allowOnSide ?? false,
                  allowExtra: m.allowExtra ?? false,
                  extraPrice: m.extraPrice ?? 0,
                  sortOrder: m.sortOrder ?? i,
                  isDefault: m.isDefault ?? false,
                  ingredientId: m.ingredientId || null,
                  ingredientName: m.ingredientName || null,
                  inventoryDeductionAmount: m.inventoryDeductionAmount ?? null,
                  inventoryDeductionUnit: m.inventoryDeductionUnit || null,
                  showOnPOS: m.showOnPOS ?? true,
                  showOnline: m.showOnline ?? true,
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
    })

    void notifyDataChanged({ locationId, domain: 'menu', action: 'updated', entityId: id })
    void pushUpstream()

    return ok(formatTemplate(template))
  } catch (error) {
    console.error('Error updating modifier template:', error)
    return err('Failed to update template', 500)
  }
})

// DELETE /api/menu/modifier-templates/[id] — soft delete
export const DELETE = withVenue(async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Auth check — require menu.edit_items permission
    const actorDel = await getActorFromRequest(request)
    const authDel = await requirePermission(actorDel.employeeId, locationId, PERMISSIONS.MENU_EDIT_ITEMS)
    if (!authDel.authorized) return err(authDel.error, authDel.status)

    const existing = await db.modifierGroupTemplate.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!existing) {
      return notFound('Template not found')
    }

    await db.modifierGroupTemplate.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    void notifyDataChanged({ locationId, domain: 'menu', action: 'deleted', entityId: id })
    void pushUpstream()

    return ok({ success: true })
  } catch (error) {
    console.error('Error deleting modifier template:', error)
    return err('Failed to delete template', 500)
  }
})
