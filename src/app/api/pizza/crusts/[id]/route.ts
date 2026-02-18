import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// PATCH /api/pizza/crusts/[id] - Update pizza crust
export const PATCH = withVenue(async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await db.pizzaCrust.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Crust not found' }, { status: 404 })
    }

    if (body.isDefault) {
      await db.pizzaCrust.updateMany({
        where: { locationId: existing.locationId, isDefault: true, id: { not: id } },
        data: { isDefault: false }
      })
    }

    const crust = await db.pizzaCrust.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.displayName !== undefined && { displayName: body.displayName?.trim() || null }),
        ...(body.description !== undefined && { description: body.description?.trim() || null }),
        ...(body.price !== undefined && { price: body.price }),
        ...(body.isDefault !== undefined && { isDefault: body.isDefault }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
      }
    })

    return NextResponse.json({ data: {
      ...crust,
      price: Number(crust.price),
    } })
  } catch (error) {
    console.error('Failed to update pizza crust:', error)
    return NextResponse.json({ error: 'Failed to update pizza crust' }, { status: 500 })
  }
})

// DELETE /api/pizza/crusts/[id] - Delete pizza crust (soft delete)
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    await db.pizzaCrust.update({
      where: { id },
      data: { isActive: false }
    })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete pizza crust:', error)
    return NextResponse.json({ error: 'Failed to delete pizza crust' }, { status: 500 })
  }
})
