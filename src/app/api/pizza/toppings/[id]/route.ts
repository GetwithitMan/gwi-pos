import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET /api/pizza/toppings/[id] - Get single pizza topping
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const topping = await db.pizzaTopping.findUnique({ where: { id } })

    if (!topping) {
      return NextResponse.json({ error: 'Topping not found' }, { status: 404 })
    }

    return NextResponse.json({ data: {
      ...topping,
      price: Number(topping.price),
      extraPrice: topping.extraPrice ? Number(topping.extraPrice) : null,
    } })
  } catch (error) {
    console.error('Failed to get pizza topping:', error)
    return NextResponse.json({ error: 'Failed to get pizza topping' }, { status: 500 })
  }
})

// PATCH /api/pizza/toppings/[id] - Update pizza topping
export const PATCH = withVenue(async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await db.pizzaTopping.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Topping not found' }, { status: 404 })
    }

    const topping = await db.pizzaTopping.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.displayName !== undefined && { displayName: body.displayName?.trim() || null }),
        ...(body.description !== undefined && { description: body.description?.trim() || null }),
        ...(body.category !== undefined && { category: body.category }),
        ...(body.price !== undefined && { price: body.price }),
        ...(body.extraPrice !== undefined && { extraPrice: body.extraPrice }),
        ...(body.color !== undefined && { color: body.color }),
        ...(body.iconUrl !== undefined && { iconUrl: body.iconUrl }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
      }
    })

    return NextResponse.json({ data: {
      ...topping,
      price: Number(topping.price),
      extraPrice: topping.extraPrice ? Number(topping.extraPrice) : null,
    } })
  } catch (error) {
    console.error('Failed to update pizza topping:', error)
    return NextResponse.json({ error: 'Failed to update pizza topping' }, { status: 500 })
  }
})

// DELETE /api/pizza/toppings/[id] - Delete pizza topping (soft delete)
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    await db.pizzaTopping.update({
      where: { id },
      data: { isActive: false }
    })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete pizza topping:', error)
    return NextResponse.json({ error: 'Failed to delete pizza topping' }, { status: 500 })
  }
})
