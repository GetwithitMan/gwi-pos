import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET single modifier group with modifiers
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const modifierGroup = await db.modifierGroup.findUnique({
      where: { id },
      include: {
        modifiers: {
          orderBy: { sortOrder: 'asc' },
        },
        menuItems: {
          include: {
            menuItem: {
              select: { id: true, name: true }
            }
          }
        }
      }
    })

    if (!modifierGroup) {
      return NextResponse.json(
        { error: 'Modifier group not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      id: modifierGroup.id,
      name: modifierGroup.name,
      displayName: modifierGroup.displayName,
      minSelections: modifierGroup.minSelections,
      maxSelections: modifierGroup.maxSelections,
      isRequired: modifierGroup.isRequired,
      sortOrder: modifierGroup.sortOrder,
      modifiers: modifierGroup.modifiers.map(mod => ({
        id: mod.id,
        name: mod.name,
        displayName: mod.displayName,
        price: Number(mod.price),
        preModifier: mod.preModifier,
        sortOrder: mod.sortOrder,
        isDefault: mod.isDefault,
        isActive: mod.isActive,
      })),
      linkedItems: modifierGroup.menuItems.map(link => ({
        id: link.menuItem.id,
        name: link.menuItem.name,
      }))
    })
  } catch (error) {
    console.error('Failed to fetch modifier group:', error)
    return NextResponse.json(
      { error: 'Failed to fetch modifier group' },
      { status: 500 }
    )
  }
}

// PUT update modifier group
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, displayName, minSelections, maxSelections, isRequired, modifiers } = body

    // Update modifier group
    const modifierGroup = await db.modifierGroup.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(displayName !== undefined && { displayName }),
        ...(minSelections !== undefined && { minSelections }),
        ...(maxSelections !== undefined && { maxSelections }),
        ...(isRequired !== undefined && { isRequired }),
      }
    })

    // If modifiers array provided, update them
    if (modifiers && Array.isArray(modifiers)) {
      // Get existing modifier IDs
      const existingModifiers = await db.modifier.findMany({
        where: { modifierGroupId: id },
        select: { id: true }
      })
      const existingIds = new Set(existingModifiers.map(m => m.id))
      const providedIds = new Set(modifiers.filter((m: { id?: string }) => m.id).map((m: { id: string }) => m.id))

      // Delete modifiers not in the provided list
      const toDelete = [...existingIds].filter(existingId => !providedIds.has(existingId))
      if (toDelete.length > 0) {
        await db.modifier.deleteMany({
          where: { id: { in: toDelete } }
        })
      }

      // Update or create modifiers
      for (let i = 0; i < modifiers.length; i++) {
        const mod = modifiers[i] as {
          id?: string
          name: string
          price?: number
          preModifier?: string
          isDefault?: boolean
          isActive?: boolean
        }

        if (mod.id && existingIds.has(mod.id)) {
          // Update existing
          await db.modifier.update({
            where: { id: mod.id },
            data: {
              name: mod.name,
              price: mod.price ?? 0,
              preModifier: mod.preModifier || null,
              isDefault: mod.isDefault ?? false,
              isActive: mod.isActive ?? true,
              sortOrder: i,
            }
          })
        } else {
          // Create new
          await db.modifier.create({
            data: {
              modifierGroupId: id,
              name: mod.name,
              price: mod.price ?? 0,
              preModifier: mod.preModifier || null,
              isDefault: mod.isDefault ?? false,
              isActive: mod.isActive ?? true,
              sortOrder: i,
            }
          })
        }
      }
    }

    // Fetch updated data
    const updated = await db.modifierGroup.findUnique({
      where: { id },
      include: {
        modifiers: {
          orderBy: { sortOrder: 'asc' },
        }
      }
    })

    return NextResponse.json({
      id: updated!.id,
      name: updated!.name,
      displayName: updated!.displayName,
      minSelections: updated!.minSelections,
      maxSelections: updated!.maxSelections,
      isRequired: updated!.isRequired,
      modifiers: updated!.modifiers.map(mod => ({
        id: mod.id,
        name: mod.name,
        price: Number(mod.price),
        preModifier: mod.preModifier,
        isDefault: mod.isDefault,
        isActive: mod.isActive,
      }))
    })
  } catch (error) {
    console.error('Failed to update modifier group:', error)
    return NextResponse.json(
      { error: 'Failed to update modifier group' },
      { status: 500 }
    )
  }
}

// DELETE modifier group
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Delete modifier group (modifiers cascade delete)
    await db.modifierGroup.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete modifier group:', error)
    return NextResponse.json(
      { error: 'Failed to delete modifier group' },
      { status: 500 }
    )
  }
}
