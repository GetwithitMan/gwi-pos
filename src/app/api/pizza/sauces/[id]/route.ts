import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// PATCH /api/pizza/sauces/[id] - Update pizza sauce
export const PATCH = withVenue(async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await db.pizzaSauce.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Sauce not found' }, { status: 404 })
    }

    if (body.isDefault) {
      await db.pizzaSauce.updateMany({
        where: { locationId: existing.locationId, isDefault: true, id: { not: id } },
        data: { isDefault: false }
      })
    }

    const sauce = await db.pizzaSauce.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.displayName !== undefined && { displayName: body.displayName?.trim() || null }),
        ...(body.description !== undefined && { description: body.description?.trim() || null }),
        ...(body.price !== undefined && { price: body.price }),
        ...(body.allowLight !== undefined && { allowLight: body.allowLight }),
        ...(body.allowExtra !== undefined && { allowExtra: body.allowExtra }),
        ...(body.extraPrice !== undefined && { extraPrice: body.extraPrice }),
        ...(body.isDefault !== undefined && { isDefault: body.isDefault }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
      }
    })

    return NextResponse.json({ data: {
      ...sauce,
      price: Number(sauce.price),
      extraPrice: Number(sauce.extraPrice),
    } })
  } catch (error) {
    console.error('Failed to update pizza sauce:', error)
    return NextResponse.json({ error: 'Failed to update pizza sauce' }, { status: 500 })
  }
})

// DELETE /api/pizza/sauces/[id] - Delete pizza sauce (soft delete)
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    await db.pizzaSauce.update({
      where: { id },
      data: { isActive: false }
    })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete pizza sauce:', error)
    return NextResponse.json({ error: 'Failed to delete pizza sauce' }, { status: 500 })
  }
})
