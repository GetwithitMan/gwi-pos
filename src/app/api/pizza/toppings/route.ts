import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'

// GET /api/pizza/toppings - Get all pizza toppings
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')
    const includeInactive = searchParams.get('includeInactive') === 'true'

    const toppings = await db.pizzaTopping.findMany({
      where: {
        locationId,
        ...(category && { category }),
        ...(!includeInactive && { isActive: true }),
      },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }]
    })

    return NextResponse.json(toppings.map(topping => ({
      ...topping,
      price: Number(topping.price),
      extraPrice: topping.extraPrice ? Number(topping.extraPrice) : null,
    })))
  } catch (error) {
    console.error('Failed to get pizza toppings:', error)
    return NextResponse.json({ error: 'Failed to get pizza toppings' }, { status: 500 })
  }
})

// POST /api/pizza/toppings - Create pizza topping
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, displayName, description, category, price, extraPrice, color, iconUrl } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }
    if (price === undefined || price < 0) {
      return NextResponse.json({ error: 'Valid price is required' }, { status: 400 })
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const maxSort = await db.pizzaTopping.aggregate({
      where: { locationId, category: category || 'standard' },
      _max: { sortOrder: true }
    })

    const topping = await db.pizzaTopping.create({
      data: {
        locationId,
        name: name.trim(),
        displayName: displayName?.trim() || null,
        description: description?.trim() || null,
        category: category || 'standard',
        price,
        extraPrice: extraPrice || null,
        color: color || null,
        iconUrl: iconUrl || null,
        sortOrder: (maxSort._max.sortOrder || 0) + 1,
      }
    })

    return NextResponse.json({ data: {
      ...topping,
      price: Number(topping.price),
      extraPrice: topping.extraPrice ? Number(topping.extraPrice) : null,
    } })
  } catch (error) {
    console.error('Failed to create pizza topping:', error)
    return NextResponse.json({ error: 'Failed to create pizza topping' }, { status: 500 })
  }
})
