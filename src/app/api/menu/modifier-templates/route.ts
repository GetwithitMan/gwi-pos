import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { getActorFromRequest, requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { created, err, notFound, ok } from '@/lib/api-response'

const ALLOWED_MODIFIER_TYPES = ['food', 'liquor', 'universal'] as const

function normalizeModifierTypes(types: unknown): string[] {
  if (!Array.isArray(types)) return ['food']
  const valid = types
    .filter((t): t is string => typeof t === 'string' && ALLOWED_MODIFIER_TYPES.includes(t as any))
    .filter((t, i, arr) => arr.indexOf(t) === i) // deduplicate
  if (valid.length === 0) return ['food']
  return valid.sort() // stable sorted order
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

// GET /api/menu/modifier-templates — list all templates for location
// Supports ?type=food|liquor|universal to filter by modifierTypes
// Supports ?includeArchived=true to include soft-deleted templates
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const { searchParams } = new URL(request.url)
    const typeFilter = searchParams.get('type')
    const includeArchived = searchParams.get('includeArchived') === 'true'

    const where: any = { locationId }
    if (!includeArchived) {
      where.deletedAt = null
    }

    const templates = await db.modifierGroupTemplate.findMany({
      where,
      include: {
        modifiers: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    })

    // Filter by type if specified (JSON array contains check)
    let filtered = templates
    if (typeFilter && ALLOWED_MODIFIER_TYPES.includes(typeFilter as any)) {
      filtered = templates.filter(t => {
        const types = Array.isArray(t.modifierTypes) ? t.modifierTypes : ['food']
        return types.includes(typeFilter)
      })
    }

    return ok(filtered.map(formatTemplate))
  } catch (error) {
    console.error('Error fetching modifier templates:', error)
    return err('Failed to fetch templates', 500)
  }
})

// POST /api/menu/modifier-templates — create a new template
// Optionally copy from an existing modifier group via sourceGroupId
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Auth check — require menu.edit_items permission
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.MENU_EDIT_ITEMS)
    if (!auth.authorized) return err(auth.error, auth.status)

    const body = await request.json()
    const {
      name,
      description,
      minSelections = 0,
      maxSelections = 1,
      isRequired = false,
      allowStacking = false,
      modifierTypes: rawModifierTypes,
      sourceGroupId,
      modifiers: bodyModifiers,
    } = body

    const modifierTypes = normalizeModifierTypes(rawModifierTypes)

    if (!name) {
      return err('Template name is required')
    }

    // Check for duplicate name
    const existing = await db.modifierGroupTemplate.findUnique({
      where: { locationId_name: { locationId, name } },
    })
    if (existing && !existing.deletedAt) {
      return err('A template with this name already exists', 409)
    }

    // If copying from an existing modifier group
    let modifiersToCreate: Array<{
      locationId: string
      name: string
      displayName?: string | null
      price: number
      allowNo: boolean
      allowLite: boolean
      allowOnSide: boolean
      allowExtra: boolean
      extraPrice: number
      sortOrder: number
      isDefault: boolean
      ingredientId?: string | null
      ingredientName?: string | null
      inventoryDeductionAmount?: unknown
      inventoryDeductionUnit?: string | null
      showOnPOS?: boolean
      showOnline?: boolean
    }> = []

    if (sourceGroupId) {
      const sourceGroup = await db.modifierGroup.findFirst({
        where: { id: sourceGroupId, locationId, deletedAt: null },
        include: {
          modifiers: {
            where: { deletedAt: null },
            orderBy: { sortOrder: 'asc' },
            include: {
              ingredient: { select: { id: true, name: true } },
            },
          },
        },
      })

      if (!sourceGroup) {
        return notFound('Source modifier group not found')
      }

      modifiersToCreate = sourceGroup.modifiers.map(m => ({
        locationId,
        name: m.name,
        displayName: m.displayName || null,
        price: Number(m.price),
        allowNo: m.allowNo,
        allowLite: m.allowLite,
        allowOnSide: m.allowOnSide,
        allowExtra: m.allowExtra,
        extraPrice: Number(m.extraPrice),
        sortOrder: m.sortOrder,
        isDefault: m.isDefault,
        ingredientId: m.ingredientId || null,
        ingredientName: m.ingredient?.name || null,
        inventoryDeductionAmount: m.inventoryDeductionAmount ?? null,
        inventoryDeductionUnit: m.inventoryDeductionUnit || null,
        showOnPOS: m.showOnPOS ?? true,
        showOnline: m.showOnline ?? true,
      }))
    } else if (Array.isArray(bodyModifiers)) {
      modifiersToCreate = bodyModifiers.map((m: any, i: number) => ({
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
      }))
    }

    // Get max sort order for templates
    const maxSort = await db.modifierGroupTemplate.aggregate({
      where: { locationId },
      _max: { sortOrder: true },
    })

    const template = await db.modifierGroupTemplate.create({
      data: {
        locationId,
        name,
        description: description || null,
        minSelections,
        maxSelections,
        isRequired,
        allowStacking,
        modifierTypes,
        sortOrder: (maxSort._max.sortOrder || 0) + 1,
        modifiers: modifiersToCreate.length > 0
          ? { create: modifiersToCreate as any }
          : undefined,
      },
      include: {
        modifiers: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    void notifyDataChanged({ locationId, domain: 'menu', action: 'created', entityId: template.id })
    void pushUpstream()

    return created(formatTemplate(template))
  } catch (error) {
    console.error('Error creating modifier template:', error)
    return err('Failed to create template', 500)
  }
})
