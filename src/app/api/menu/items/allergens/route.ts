import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'

// Standard allergen list — used as default options in the UI
export const STANDARD_ALLERGENS = [
  'Milk',
  'Eggs',
  'Fish',
  'Shellfish',
  'Tree Nuts',
  'Peanuts',
  'Wheat',
  'Soy',
  'Sesame',
  'Sulfites',
  'Gluten',
] as const

// GET /api/menu/items/allergens — returns distinct allergens in use + standard list
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = request.nextUrl.searchParams.get('locationId') || await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Fetch all distinct allergens currently in use across menu items
    const items = await db.menuItem.findMany({
      where: { locationId, deletedAt: null, isActive: true },
      select: { allergens: true },
    })

    // Collect distinct allergens from all items
    const inUseSet = new Set<string>()
    for (const item of items) {
      if (item.allergens && Array.isArray(item.allergens)) {
        for (const a of item.allergens) {
          inUseSet.add(a)
        }
      }
    }

    // Merge standard list with any custom allergens already in use
    const allAllergens = new Set([...STANDARD_ALLERGENS, ...inUseSet])

    return NextResponse.json({
      data: {
        standard: [...STANDARD_ALLERGENS],
        inUse: [...inUseSet].sort(),
        all: [...allAllergens].sort(),
      },
    })
  } catch (error) {
    console.error('Failed to fetch allergens:', error)
    return NextResponse.json({ error: 'Failed to fetch allergens' }, { status: 500 })
  }
})
