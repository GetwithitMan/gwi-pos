import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - Get single void reason
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const voidReason = await db.voidReason.findUnique({
      where: { id },
    })

    if (!voidReason || voidReason.deletedAt) {
      return NextResponse.json({ error: 'Void reason not found' }, { status: 404 })
    }

    return NextResponse.json({ voidReason })
  } catch (error) {
    console.error('Get void reason error:', error)
    return NextResponse.json({ error: 'Failed to fetch void reason' }, { status: 500 })
  }
}

// PUT - Update void reason
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await db.voidReason.findUnique({
      where: { id },
    })

    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Void reason not found' }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {}
    const allowedFields = ['name', 'description', 'deductInventory', 'requiresManager', 'sortOrder', 'isActive']

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field]
      }
    }

    const voidReason = await db.voidReason.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json({ voidReason })
  } catch (error) {
    console.error('Update void reason error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Void reason with this name already exists' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to update void reason' }, { status: 500 })
  }
}

// DELETE - Soft delete void reason
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await db.voidReason.findUnique({
      where: { id },
    })

    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Void reason not found' }, { status: 404 })
    }

    await db.voidReason.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete void reason error:', error)
    return NextResponse.json({ error: 'Failed to delete void reason' }, { status: 500 })
  }
}
