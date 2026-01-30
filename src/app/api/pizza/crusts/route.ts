import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/pizza/crusts - Get all pizza crusts
export async function GET() {
  try {
    const location = await db.location.findFirst()
    if (!location) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const crusts = await db.pizzaCrust.findMany({
      where: { locationId: location.id, isActive: true },
      orderBy: { sortOrder: 'asc' }
    })

    return NextResponse.json(crusts.map(crust => ({
      ...crust,
      price: Number(crust.price),
    })))
  } catch (error) {
    console.error('Failed to get pizza crusts:', error)
    return NextResponse.json({ error: 'Failed to get pizza crusts' }, { status: 500 })
  }
}

// POST /api/pizza/crusts - Create pizza crust
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, displayName, description, price, isDefault } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const location = await db.location.findFirst()
    if (!location) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const maxSort = await db.pizzaCrust.aggregate({
      where: { locationId: location.id },
      _max: { sortOrder: true }
    })

    if (isDefault) {
      await db.pizzaCrust.updateMany({
        where: { locationId: location.id, isDefault: true },
        data: { isDefault: false }
      })
    }

    const crust = await db.pizzaCrust.create({
      data: {
        locationId: location.id,
        name: name.trim(),
        displayName: displayName?.trim() || null,
        description: description?.trim() || null,
        price: price || 0,
        isDefault: isDefault || false,
        sortOrder: (maxSort._max.sortOrder || 0) + 1,
      }
    })

    return NextResponse.json({
      ...crust,
      price: Number(crust.price),
    })
  } catch (error) {
    console.error('Failed to create pizza crust:', error)
    return NextResponse.json({ error: 'Failed to create pizza crust' }, { status: 500 })
  }
}
