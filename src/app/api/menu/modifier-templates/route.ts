import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { getActorFromRequest, requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

function formatTemplate(t: any) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    minSelections: t.minSelections,
    maxSelections: t.maxSelections,
    isRequired: t.isRequired,
    sortOrder: t.sortOrder,
    isActive: t.isActive,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    modifiers: (t.modifiers || []).map((m: any) => ({
      id: m.id,
      name: m.name,
      price: Number(m.price),
      allowNo: m.allowNo,
      allowLite: m.allowLite,
      allowOnSide: m.allowOnSide,
      allowExtra: m.allowExtra,
      extraPrice: Number(m.extraPrice),
      sortOrder: m.sortOrder,
      isDefault: m.isDefault,
    })),
  }
}

// GET /api/menu/modifier-templates — list all templates for location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const templates = await db.modifierGroupTemplate.findMany({
      where: { locationId, deletedAt: null },
      include: {
        modifiers: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ data: templates.map(formatTemplate) })
  } catch (error) {
    console.error('Error fetching modifier templates:', error)
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 })
  }
})

// POST /api/menu/modifier-templates — create a new template
// Optionally copy from an existing modifier group via sourceGroupId
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Auth check — require menu.edit_items permission
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.MENU_EDIT_ITEMS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await request.json()
    const {
      name,
      description,
      minSelections = 0,
      maxSelections = 1,
      isRequired = false,
      sourceGroupId,
      modifiers: bodyModifiers,
    } = body

    if (!name) {
      return NextResponse.json({ error: 'Template name is required' }, { status: 400 })
    }

    // Check for duplicate name
    const existing = await db.modifierGroupTemplate.findUnique({
      where: { locationId_name: { locationId, name } },
    })
    if (existing && !existing.deletedAt) {
      return NextResponse.json({ error: 'A template with this name already exists' }, { status: 409 })
    }

    // If copying from an existing modifier group
    let modifiersToCreate: Array<{
      locationId: string
      name: string
      price: number
      allowNo: boolean
      allowLite: boolean
      allowOnSide: boolean
      allowExtra: boolean
      extraPrice: number
      sortOrder: number
      isDefault: boolean
    }> = []

    if (sourceGroupId) {
      const sourceGroup = await db.modifierGroup.findFirst({
        where: { id: sourceGroupId, locationId, deletedAt: null },
        include: {
          modifiers: {
            where: { deletedAt: null },
            orderBy: { sortOrder: 'asc' },
          },
        },
      })

      if (!sourceGroup) {
        return NextResponse.json({ error: 'Source modifier group not found' }, { status: 404 })
      }

      modifiersToCreate = sourceGroup.modifiers.map(m => ({
        locationId,
        name: m.name,
        price: Number(m.price),
        allowNo: m.allowNo,
        allowLite: m.allowLite,
        allowOnSide: m.allowOnSide,
        allowExtra: m.allowExtra,
        extraPrice: Number(m.extraPrice),
        sortOrder: m.sortOrder,
        isDefault: m.isDefault,
      }))
    } else if (Array.isArray(bodyModifiers)) {
      modifiersToCreate = bodyModifiers.map((m: any, i: number) => ({
        locationId,
        name: m.name || `Modifier ${i + 1}`,
        price: m.price ?? 0,
        allowNo: m.allowNo ?? true,
        allowLite: m.allowLite ?? false,
        allowOnSide: m.allowOnSide ?? false,
        allowExtra: m.allowExtra ?? false,
        extraPrice: m.extraPrice ?? 0,
        sortOrder: m.sortOrder ?? i,
        isDefault: m.isDefault ?? false,
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
        sortOrder: (maxSort._max.sortOrder || 0) + 1,
        modifiers: modifiersToCreate.length > 0
          ? { create: modifiersToCreate }
          : undefined,
      },
      include: {
        modifiers: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    return NextResponse.json({ data: formatTemplate(template) }, { status: 201 })
  } catch (error) {
    console.error('Error creating modifier template:', error)
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 })
  }
})
