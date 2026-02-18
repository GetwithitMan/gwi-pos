import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'

// GET /api/pizza/crusts - Get all pizza crusts
export const GET = withVenue(async function GET() {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const crusts = await db.pizzaCrust.findMany({
      where: { locationId, isActive: true },
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
})

// POST /api/pizza/crusts - Create pizza crust
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, displayName, description, price, isDefault } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const maxSort = await db.pizzaCrust.aggregate({
      where: { locationId },
      _max: { sortOrder: true }
    })

    if (isDefault) {
      await db.pizzaCrust.updateMany({
        where: { locationId, isDefault: true },
        data: { isDefault: false }
      })
    }

    const crust = await db.pizzaCrust.create({
      data: {
        locationId,
        name: name.trim(),
        displayName: displayName?.trim() || null,
        description: description?.trim() || null,
        price: price || 0,
        isDefault: isDefault || false,
        sortOrder: (maxSort._max.sortOrder || 0) + 1,
      }
    })

    return NextResponse.json({ data: {
      ...crust,
      price: Number(crust.price),
    } })
  } catch (error) {
    console.error('Failed to create pizza crust:', error)
    return NextResponse.json({ error: 'Failed to create pizza crust' }, { status: 500 })
  }
})
