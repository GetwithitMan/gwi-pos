import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'

// GET /api/pizza/sizes - Get all pizza sizes
export const GET = withVenue(async function GET() {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const sizes = await db.pizzaSize.findMany({
      where: { locationId, isActive: true },
      orderBy: { sortOrder: 'asc' }
    })

    return NextResponse.json(sizes.map(size => ({
      ...size,
      basePrice: Number(size.basePrice),
      priceMultiplier: Number(size.priceMultiplier),
      toppingMultiplier: Number(size.toppingMultiplier),
    })))
  } catch (error) {
    console.error('Failed to get pizza sizes:', error)
    return NextResponse.json({ error: 'Failed to get pizza sizes' }, { status: 500 })
  }
})

// POST /api/pizza/sizes - Create pizza size
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, displayName, inches, slices, basePrice, priceMultiplier, toppingMultiplier, freeToppings, isDefault } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }
    if (basePrice === undefined || basePrice < 0) {
      return NextResponse.json({ error: 'Valid base price is required' }, { status: 400 })
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Get max sort order
    const maxSort = await db.pizzaSize.aggregate({
      where: { locationId },
      _max: { sortOrder: true }
    })

    // If this is default, unset other defaults
    if (isDefault) {
      await db.pizzaSize.updateMany({
        where: { locationId, isDefault: true },
        data: { isDefault: false }
      })
    }

    const size = await db.pizzaSize.create({
      data: {
        locationId,
        name: name.trim(),
        displayName: displayName?.trim() || null,
        inches: inches || null,
        slices: slices || 8,
        basePrice,
        priceMultiplier: priceMultiplier || 1.0,
        toppingMultiplier: toppingMultiplier || 1.0,
        freeToppings: freeToppings || 0,
        isDefault: isDefault || false,
        sortOrder: (maxSort._max.sortOrder || 0) + 1,
      }
    })

    return NextResponse.json({ data: {
      ...size,
      basePrice: Number(size.basePrice),
      priceMultiplier: Number(size.priceMultiplier),
      toppingMultiplier: Number(size.toppingMultiplier),
    } })
  } catch (error) {
    console.error('Failed to create pizza size:', error)
    return NextResponse.json({ error: 'Failed to create pizza size' }, { status: 500 })
  }
})
