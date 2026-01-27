import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - Get prep station details with assigned categories and items
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const station = await db.prepStation.findUnique({
      where: { id },
      include: {
        categories: {
          select: {
            id: true,
            name: true,
            color: true,
          },
          orderBy: { name: 'asc' },
        },
        menuItems: {
          select: {
            id: true,
            name: true,
            categoryId: true,
          },
          orderBy: { name: 'asc' },
        },
      },
    })

    if (!station) {
      return NextResponse.json(
        { error: 'Prep station not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      id: station.id,
      name: station.name,
      displayName: station.displayName,
      color: station.color,
      stationType: station.stationType,
      sortOrder: station.sortOrder,
      isActive: station.isActive,
      showAllItems: station.showAllItems,
      autoComplete: station.autoComplete,
      categories: station.categories,
      menuItems: station.menuItems,
    })
  } catch (error) {
    console.error('Failed to fetch prep station:', error)
    return NextResponse.json(
      { error: 'Failed to fetch prep station' },
      { status: 500 }
    )
  }
}

// PUT - Update prep station
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const {
      name,
      displayName,
      color,
      stationType,
      isActive,
      showAllItems,
      autoComplete,
      sortOrder,
      categoryIds,  // Array of category IDs to assign
      menuItemIds,  // Array of menu item IDs to assign (overrides)
    } = body as {
      name?: string
      displayName?: string
      color?: string
      stationType?: string
      isActive?: boolean
      showAllItems?: boolean
      autoComplete?: number | null
      sortOrder?: number
      categoryIds?: string[]
      menuItemIds?: string[]
    }

    const existing = await db.prepStation.findUnique({
      where: { id },
    })

    if (!existing) {
      return NextResponse.json(
        { error: 'Prep station not found' },
        { status: 404 }
      )
    }

    // Check for duplicate name if changing
    if (name && name !== existing.name) {
      const duplicate = await db.prepStation.findFirst({
        where: {
          locationId: existing.locationId,
          name: { equals: name, mode: 'insensitive' },
          id: { not: id },
        },
      })

      if (duplicate) {
        return NextResponse.json(
          { error: 'A prep station with this name already exists' },
          { status: 409 }
        )
      }
    }

    // Build update data
    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (displayName !== undefined) updateData.displayName = displayName
    if (color !== undefined) updateData.color = color
    if (stationType !== undefined) updateData.stationType = stationType
    if (isActive !== undefined) updateData.isActive = isActive
    if (showAllItems !== undefined) updateData.showAllItems = showAllItems
    if (autoComplete !== undefined) updateData.autoComplete = autoComplete
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder

    // Handle category assignments
    if (categoryIds !== undefined) {
      updateData.categories = {
        set: categoryIds.map(catId => ({ id: catId })),
      }
    }

    // Handle menu item assignments (overrides)
    if (menuItemIds !== undefined) {
      updateData.menuItems = {
        set: menuItemIds.map(itemId => ({ id: itemId })),
      }
    }

    const station = await db.prepStation.update({
      where: { id },
      data: updateData,
      include: {
        _count: {
          select: {
            categories: true,
            menuItems: true,
          },
        },
      },
    })

    return NextResponse.json({
      id: station.id,
      name: station.name,
      displayName: station.displayName,
      color: station.color,
      stationType: station.stationType,
      sortOrder: station.sortOrder,
      isActive: station.isActive,
      showAllItems: station.showAllItems,
      autoComplete: station.autoComplete,
      categoryCount: station._count.categories,
      itemCount: station._count.menuItems,
    })
  } catch (error) {
    console.error('Failed to update prep station:', error)
    return NextResponse.json(
      { error: 'Failed to update prep station' },
      { status: 500 }
    )
  }
}

// DELETE - Delete prep station
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const station = await db.prepStation.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            categories: true,
            menuItems: true,
          },
        },
      },
    })

    if (!station) {
      return NextResponse.json(
        { error: 'Prep station not found' },
        { status: 404 }
      )
    }

    // Remove assignments first
    await db.prepStation.update({
      where: { id },
      data: {
        categories: { set: [] },
        menuItems: { set: [] },
      },
    })

    // Delete the station
    await db.prepStation.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete prep station:', error)
    return NextResponse.json(
      { error: 'Failed to delete prep station' },
      { status: 500 }
    )
  }
}
