import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET /api/pizza/sizes/[id] - Get single pizza size
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const size = await db.pizzaSize.findUnique({ where: { id } })

    if (!size) {
      return NextResponse.json({ error: 'Size not found' }, { status: 404 })
    }

    return NextResponse.json({
      ...size,
      basePrice: Number(size.basePrice),
      priceMultiplier: Number(size.priceMultiplier),
      toppingMultiplier: Number(size.toppingMultiplier),
    })
  } catch (error) {
    console.error('Failed to get pizza size:', error)
    return NextResponse.json({ error: 'Failed to get pizza size' }, { status: 500 })
  }
})

// PATCH /api/pizza/sizes/[id] - Update pizza size
export const PATCH = withVenue(async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await db.pizzaSize.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Size not found' }, { status: 404 })
    }

    // If setting as default, unset other defaults
    if (body.isDefault) {
      await db.pizzaSize.updateMany({
        where: { locationId: existing.locationId, isDefault: true, id: { not: id } },
        data: { isDefault: false }
      })
    }

    const size = await db.pizzaSize.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.displayName !== undefined && { displayName: body.displayName?.trim() || null }),
        ...(body.inches !== undefined && { inches: body.inches }),
        ...(body.slices !== undefined && { slices: body.slices }),
        ...(body.basePrice !== undefined && { basePrice: body.basePrice }),
        ...(body.priceMultiplier !== undefined && { priceMultiplier: body.priceMultiplier }),
        ...(body.toppingMultiplier !== undefined && { toppingMultiplier: body.toppingMultiplier }),
        ...(body.freeToppings !== undefined && { freeToppings: body.freeToppings }),
        ...(body.isDefault !== undefined && { isDefault: body.isDefault }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
      }
    })

    return NextResponse.json({
      ...size,
      basePrice: Number(size.basePrice),
      priceMultiplier: Number(size.priceMultiplier),
      toppingMultiplier: Number(size.toppingMultiplier),
    })
  } catch (error) {
    console.error('Failed to update pizza size:', error)
    return NextResponse.json({ error: 'Failed to update pizza size' }, { status: 500 })
  }
})

// DELETE /api/pizza/sizes/[id] - Delete pizza size (soft delete)
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    await db.pizzaSize.update({
      where: { id },
      data: { isActive: false }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete pizza size:', error)
    return NextResponse.json({ error: 'Failed to delete pizza size' }, { status: 500 })
  }
})
