import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET - Get a single tray config
export const GET = withVenue(async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params

    const config = await db.prepTrayConfig.findUnique({
      where: { id },
      include: {
        ingredient: {
          select: { id: true, name: true, standardUnit: true },
        },
      },
    })

    if (!config || config.deletedAt) {
      return NextResponse.json({ error: 'Tray config not found' }, { status: 404 })
    }

    return NextResponse.json({
      data: {
        ...config,
        capacity: Number(config.capacity),
      },
    })
  } catch (error) {
    console.error('Get tray config error:', error)
    return NextResponse.json({ error: 'Failed to fetch tray config' }, { status: 500 })
  }
})

// PUT - Update a tray config
export const PUT = withVenue(async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, capacity, description, sortOrder, isActive } = body

    const existing = await db.prepTrayConfig.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Tray config not found' }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (capacity !== undefined) updateData.capacity = Number(capacity)
    if (description !== undefined) updateData.description = description
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder
    if (isActive !== undefined) updateData.isActive = isActive

    const config = await db.prepTrayConfig.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json({
      data: {
        ...config,
        capacity: Number(config.capacity),
      },
    })
  } catch (error) {
    console.error('Update tray config error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'A tray config with this name already exists for this prep item' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to update tray config' }, { status: 500 })
  }
})

// DELETE - Soft delete a tray config
export const DELETE = withVenue(async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params

    const existing = await db.prepTrayConfig.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Tray config not found' }, { status: 404 })
    }

    await db.prepTrayConfig.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ data: { message: 'Tray config deleted' } })
  } catch (error) {
    console.error('Delete tray config error:', error)
    return NextResponse.json({ error: 'Failed to delete tray config' }, { status: 500 })
  }
})
