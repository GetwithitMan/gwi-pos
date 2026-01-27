import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET all modifier groups with their modifiers
export async function GET() {
  try {
    const modifierGroups = await db.modifierGroup.findMany({
      orderBy: { sortOrder: 'asc' },
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

    return NextResponse.json({
      modifierGroups: modifierGroups.map(group => ({
        id: group.id,
        name: group.name,
        displayName: group.displayName,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        isRequired: group.isRequired,
        sortOrder: group.sortOrder,
        modifiers: group.modifiers.map(mod => ({
          id: mod.id,
          name: mod.name,
          displayName: mod.displayName,
          price: Number(mod.price),
          preModifier: mod.preModifier,
          sortOrder: mod.sortOrder,
          isDefault: mod.isDefault,
          isActive: mod.isActive,
        })),
        linkedItems: group.menuItems.map(link => ({
          id: link.menuItem.id,
          name: link.menuItem.name,
        }))
      }))
    })
  } catch (error) {
    console.error('Failed to fetch modifier groups:', error)
    return NextResponse.json(
      { error: 'Failed to fetch modifier groups' },
      { status: 500 }
    )
  }
}

// POST create new modifier group
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, displayName, minSelections, maxSelections, isRequired, modifiers } = body

    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      )
    }

    // Get the location
    const location = await db.location.findFirst()
    if (!location) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    // Get max sort order
    const maxSortOrder = await db.modifierGroup.aggregate({
      where: { locationId: location.id },
      _max: { sortOrder: true }
    })

    const modifierGroup = await db.modifierGroup.create({
      data: {
        locationId: location.id,
        name: name.trim(),
        displayName: displayName?.trim() || null,
        minSelections: minSelections || 0,
        maxSelections: maxSelections || 1,
        isRequired: isRequired || false,
        sortOrder: (maxSortOrder._max.sortOrder || 0) + 1,
        modifiers: modifiers?.length ? {
          create: modifiers.map((mod: { name: string; price: number; preModifier?: string }, index: number) => ({
            name: mod.name,
            price: mod.price || 0,
            preModifier: mod.preModifier || null,
            sortOrder: index,
          }))
        } : undefined
      },
      include: {
        modifiers: true
      }
    })

    return NextResponse.json({
      id: modifierGroup.id,
      name: modifierGroup.name,
      displayName: modifierGroup.displayName,
      minSelections: modifierGroup.minSelections,
      maxSelections: modifierGroup.maxSelections,
      isRequired: modifierGroup.isRequired,
      modifiers: modifierGroup.modifiers.map(mod => ({
        id: mod.id,
        name: mod.name,
        price: Number(mod.price),
        preModifier: mod.preModifier,
      }))
    })
  } catch (error) {
    console.error('Failed to create modifier group:', error)
    return NextResponse.json(
      { error: 'Failed to create modifier group' },
      { status: 500 }
    )
  }
}
