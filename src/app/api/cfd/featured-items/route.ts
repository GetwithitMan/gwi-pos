import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET featured menu items for CFD idle screen
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId query parameter is required' },
        { status: 400 }
      )
    }

    const menuItems = await db.menuItem.findMany({
      where: {
        locationId,
        isFeaturedCfd: true,
        isActive: true,
        deletedAt: null,
      },
      include: {
        category: {
          select: { name: true },
        },
      },
      orderBy: [
        { sortOrder: 'asc' },
        { name: 'asc' },
      ],
    })

    const items = menuItems.map((item) => ({
      id: item.id,
      name: item.displayName || item.name,
      price: Number(item.price),
      description: item.description,
      imageUrl: item.imageUrl,
      categoryName: item.category.name,
    }))

    return NextResponse.json({ items })
  } catch (error) {
    console.error('Failed to fetch featured CFD items:', error)
    return NextResponse.json(
      { error: 'Failed to fetch featured items' },
      { status: 500 }
    )
  }
})
