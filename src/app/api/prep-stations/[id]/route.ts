import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - Get a single prep station
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const station = await db.prepStation.findUnique({
      where: { id },
      include: { categories: { select: { id: true, name: true } } },
    })

    if (!station) {
      return NextResponse.json({ error: 'Prep station not found' }, { status: 404 })
    }

    return NextResponse.json({ station })
  } catch (error) {
    console.error('Failed to fetch prep station:', error)
    return NextResponse.json({ error: 'Failed to fetch prep station' }, { status: 500 })
  }
}

// PUT - Update a prep station
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await db.prepStation.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Prep station not found' }, { status: 404 })
    }

    const station = await db.prepStation.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.displayName !== undefined && { displayName: body.displayName }),
        ...(body.color !== undefined && { color: body.color }),
        ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.categoryIds !== undefined && {
          categories: { set: body.categoryIds.map((id: string) => ({ id })) },
        }),
      },
      include: { categories: { select: { id: true, name: true } } },
    })

    return NextResponse.json({ station })
  } catch (error) {
    console.error('Failed to update prep station:', error)
    return NextResponse.json({ error: 'Failed to update prep station' }, { status: 500 })
  }
}

// DELETE - Delete a prep station
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const station = await db.prepStation.findUnique({ where: { id } })
    if (!station) {
      return NextResponse.json({ error: 'Prep station not found' }, { status: 404 })
    }

    await db.prepStation.update({ where: { id }, data: { deletedAt: new Date() } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete prep station:', error)
    return NextResponse.json({ error: 'Failed to delete prep station' }, { status: 500 })
  }
}
