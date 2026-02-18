import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'

// GET /api/pizza/cheeses - Get all pizza cheeses
export const GET = withVenue(async function GET() {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const cheeses = await db.pizzaCheese.findMany({
      where: { locationId, isActive: true },
      orderBy: { sortOrder: 'asc' }
    })

    return NextResponse.json(cheeses.map(cheese => ({
      ...cheese,
      price: Number(cheese.price),
      extraPrice: Number(cheese.extraPrice),
    })))
  } catch (error) {
    console.error('Failed to get pizza cheeses:', error)
    return NextResponse.json({ error: 'Failed to get pizza cheeses' }, { status: 500 })
  }
})

// POST /api/pizza/cheeses - Create pizza cheese
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, displayName, description, price, allowLight, allowExtra, extraPrice, isDefault } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const maxSort = await db.pizzaCheese.aggregate({
      where: { locationId },
      _max: { sortOrder: true }
    })

    if (isDefault) {
      await db.pizzaCheese.updateMany({
        where: { locationId, isDefault: true },
        data: { isDefault: false }
      })
    }

    const cheese = await db.pizzaCheese.create({
      data: {
        locationId,
        name: name.trim(),
        displayName: displayName?.trim() || null,
        description: description?.trim() || null,
        price: price || 0,
        allowLight: allowLight ?? true,
        allowExtra: allowExtra ?? true,
        extraPrice: extraPrice || 0,
        isDefault: isDefault || false,
        sortOrder: (maxSort._max.sortOrder || 0) + 1,
      }
    })

    return NextResponse.json({ data: {
      ...cheese,
      price: Number(cheese.price),
      extraPrice: Number(cheese.extraPrice),
    } })
  } catch (error) {
    console.error('Failed to create pizza cheese:', error)
    return NextResponse.json({ error: 'Failed to create pizza cheese' }, { status: 500 })
  }
})
