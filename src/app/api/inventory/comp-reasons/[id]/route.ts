import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { withAuth } from '@/lib/api-auth-middleware'

// GET - Get single comp reason
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const compReason = await db.compReason.findUnique({
      where: { id },
    })

    if (!compReason || compReason.deletedAt) {
      return NextResponse.json({ error: 'Comp reason not found' }, { status: 404 })
    }

    return NextResponse.json({ data: { compReason } })
  } catch (error) {
    console.error('Get comp reason error:', error)
    return NextResponse.json({ error: 'Failed to fetch comp reason' }, { status: 500 })
  }
})

// PUT - Update comp reason
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await db.compReason.findUnique({
      where: { id },
    })

    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Comp reason not found' }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {}
    const allowedFields = ['name', 'description', 'deductInventory', 'requiresManager', 'sortOrder', 'isActive']

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field]
      }
    }

    const compReason = await db.compReason.update({
      where: { id },
      data: updateData,
    })

    void notifyDataChanged({ locationId: existing.locationId, domain: 'reasons', action: 'updated', entityId: id })

    return NextResponse.json({ data: { compReason } })
  } catch (error) {
    console.error('Update comp reason error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Comp reason with this name already exists' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to update comp reason' }, { status: 500 })
  }
}))

// DELETE - Soft delete comp reason
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await db.compReason.findUnique({
      where: { id },
    })

    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Comp reason not found' }, { status: 404 })
    }

    await db.compReason.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    void notifyDataChanged({ locationId: existing.locationId, domain: 'reasons', action: 'deleted', entityId: id })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Delete comp reason error:', error)
    return NextResponse.json({ error: 'Failed to delete comp reason' }, { status: 500 })
  }
}))
