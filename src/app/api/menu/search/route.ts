import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// Force dynamic rendering - never cache search results
export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const query = searchParams.get('q')
    const limitParam = searchParams.get('limit')
    const limit = limitParam ? parseInt(limitParam, 10) : 30

    // Validate required parameters
    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Require minimum 2 characters for search
    if (!query || query.trim().length < 2) {
      return NextResponse.json({ data: {
        directMatches: [],
        ingredientMatches: [],
        totalMatches: 0
      } })
    }

    const searchQuery = query.trim()

    // 1. Direct menu item name search
    const directMatches = await db.menuItem.findMany({
      where: {
        locationId,
        deletedAt: null,
        isActive: true,
        name: { contains: searchQuery }
      },
      take: limit,
      select: {
        id: true,
        name: true,
        price: true,
        categoryId: true,
        isAvailable: true,
      }
    })

    // 2. Spirit matches (BottleProduct)
    const spiritMatches = await db.bottleProduct.findMany({
      where: {
        locationId,
        deletedAt: null,
        OR: [
          { name: { contains: searchQuery } },
          { brand: { contains: searchQuery } }
        ]
      },
      include: {
        recipeIngredients: {
          where: { deletedAt: null },
          include: {
            menuItem: {
              select: {
                id: true,
                name: true,
                price: true,
                categoryId: true,
                isAvailable: true,
                isActive: true,
                deletedAt: true,
              }
            }
          }
        }
      }
    })

    // 3. Food ingredient matches
    const foodMatches = await db.ingredient.findMany({
      where: {
        locationId,
        deletedAt: null,
        name: { contains: searchQuery }
      },
      include: {
        menuItemIngredients: {
          where: { deletedAt: null },
          include: {
            menuItem: {
              select: {
                id: true,
                name: true,
                price: true,
                categoryId: true,
                isAvailable: true,
                isActive: true,
                deletedAt: true,
              }
            }
          }
        }
      }
    })

    // Build ingredient matches structure and collect item IDs for deduplication
    const directMatchIds = new Set(directMatches.map(item => item.id))
    const ingredientMatches: Array<{
      ingredientType: string
      ingredientName: string
      ingredientId: string
      items: Array<{
        id: string
        name: string
        price: number
        categoryId: string
        isAvailable: boolean
      }>
    }> = []

    // Process spirit matches
    spiritMatches.forEach(spirit => {
      const items = spirit.recipeIngredients
        .map(ri => ri.menuItem)
        .filter(item =>
          item &&
          item.deletedAt === null &&
          item.isActive === true &&
          !directMatchIds.has(item.id)
        )

      if (items.length > 0) {
        ingredientMatches.push({
          ingredientType: 'spirit',
          ingredientName: spirit.brand ? `${spirit.brand} ${spirit.name}` : spirit.name,
          ingredientId: spirit.id,
          items: items.map(item => ({
            id: item.id,
            name: item.name,
            price: Number(item.price),
            categoryId: item.categoryId,
            isAvailable: item.isAvailable ?? true,
          }))
        })
      }
    })

    // Process food ingredient matches
    foodMatches.forEach(ingredient => {
      const items = ingredient.menuItemIngredients
        .map(mii => mii.menuItem)
        .filter(item =>
          item &&
          item.deletedAt === null &&
          item.isActive === true &&
          !directMatchIds.has(item.id)
        )

      if (items.length > 0) {
        ingredientMatches.push({
          ingredientType: 'ingredient',
          ingredientName: ingredient.name,
          ingredientId: ingredient.id,
          items: items.map(item => ({
            id: item.id,
            name: item.name,
            price: Number(item.price),
            categoryId: item.categoryId,
            isAvailable: item.isAvailable ?? true,
          }))
        })
      }
    })

    // Calculate total matches (direct + all ingredient-matched items)
    const totalIngredientItems = ingredientMatches.reduce((sum, ing) => sum + ing.items.length, 0)
    const totalMatches = directMatches.length + totalIngredientItems

    // Prepare response
    const response = NextResponse.json({ data: {
      directMatches: directMatches.map(item => ({
        id: item.id,
        name: item.name,
        price: Number(item.price),
        categoryId: item.categoryId,
        isAvailable: item.isAvailable ?? true,
      })),
      ingredientMatches,
      totalMatches
    } })

    // Prevent caching
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    response.headers.set('Pragma', 'no-cache')

    return response

  } catch (error) {
    console.error('Menu search error:', error)
    return NextResponse.json(
      { error: 'Failed to search menu' },
      { status: 500 }
    )
  }
})
