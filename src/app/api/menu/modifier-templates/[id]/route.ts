import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'

interface RouteParams {
  params: Promise<{ id: string }>
}

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

// GET /api/menu/modifier-templates/[id] — get single template with modifiers
export const GET = withVenue(async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
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
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    return NextResponse.json({ data: formatTemplate(template) })
  } catch (error) {
    console.error('Error fetching modifier template:', error)
    return NextResponse.json({ error: 'Failed to fetch template' }, { status: 500 })
  }
})

// PUT /api/menu/modifier-templates/[id] — full replace template + modifiers
export const PUT = withVenue(async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const existing = await db.modifierGroupTemplate.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const body = await request.json()
    const {
      name,
      description,
      minSelections,
      maxSelections,
      isRequired,
      modifiers: bodyModifiers,
    } = body

    // Check for duplicate name (if name is changing)
    if (name && name !== existing.name) {
      const duplicate = await db.modifierGroupTemplate.findUnique({
        where: { locationId_name: { locationId, name } },
      })
      if (duplicate && !duplicate.deletedAt) {
        return NextResponse.json({ error: 'A template with this name already exists' }, { status: 409 })
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
          modifiers: Array.isArray(bodyModifiers)
            ? {
                create: bodyModifiers.map((m: any, i: number) => ({
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

    return NextResponse.json({ data: formatTemplate(template) })
  } catch (error) {
    console.error('Error updating modifier template:', error)
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 })
  }
})

// DELETE /api/menu/modifier-templates/[id] — soft delete
export const DELETE = withVenue(async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const existing = await db.modifierGroupTemplate.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    await db.modifierGroupTemplate.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Error deleting modifier template:', error)
    return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 })
  }
})
