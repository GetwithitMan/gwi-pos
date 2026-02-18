import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'

// GET /api/pizza/specialties - Get all specialty pizzas
export const GET = withVenue(async function GET() {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const specialties = await db.pizzaSpecialty.findMany({
      where: { locationId },
      include: {
        menuItem: true,
        defaultCrust: true,
        defaultSauce: true,
        defaultCheese: true,
      },
      orderBy: { menuItem: { sortOrder: 'asc' } }
    })

    return NextResponse.json(specialties.map(specialty => ({
      ...specialty,
      toppings: specialty.toppings as Array<{
        toppingId: string
        name: string
        sections: number[]
        amount: string
      }>,
      menuItem: {
        ...specialty.menuItem,
        price: Number(specialty.menuItem.price),
      },
      defaultCrust: specialty.defaultCrust ? {
        ...specialty.defaultCrust,
        price: Number(specialty.defaultCrust.price),
      } : null,
      defaultSauce: specialty.defaultSauce ? {
        ...specialty.defaultSauce,
        price: Number(specialty.defaultSauce.price),
        extraPrice: Number(specialty.defaultSauce.extraPrice),
      } : null,
      defaultCheese: specialty.defaultCheese ? {
        ...specialty.defaultCheese,
        price: Number(specialty.defaultCheese.price),
        extraPrice: Number(specialty.defaultCheese.extraPrice),
      } : null,
    })))
  } catch (error) {
    console.error('Failed to get pizza specialties:', error)
    return NextResponse.json({ error: 'Failed to get pizza specialties' }, { status: 500 })
  }
})

// POST /api/pizza/specialties - Create specialty pizza
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      menuItemId,
      defaultCrustId,
      defaultSauceId,
      defaultCheeseId,
      sauceAmount,
      cheeseAmount,
      toppings,
      allowSizeChange,
      allowCrustChange,
      allowSauceChange,
      allowCheeseChange,
      allowToppingMods,
    } = body

    if (!menuItemId) {
      return NextResponse.json({ error: 'Menu item ID is required' }, { status: 400 })
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Verify menu item exists and is a pizza
    const menuItem = await db.menuItem.findFirst({
      where: { id: menuItemId, locationId },
      include: { category: true }
    })

    if (!menuItem) {
      return NextResponse.json({ error: 'Menu item not found' }, { status: 404 })
    }

    // Check if specialty already exists for this menu item
    const existing = await db.pizzaSpecialty.findUnique({
      where: { menuItemId }
    })

    if (existing) {
      return NextResponse.json({ error: 'Specialty already exists for this menu item' }, { status: 400 })
    }

    const specialty = await db.pizzaSpecialty.create({
      data: {
        locationId,
        menuItemId,
        defaultCrustId: defaultCrustId || null,
        defaultSauceId: defaultSauceId || null,
        defaultCheeseId: defaultCheeseId || null,
        sauceAmount: sauceAmount || 'regular',
        cheeseAmount: cheeseAmount || 'regular',
        toppings: toppings || [],
        allowSizeChange: allowSizeChange ?? true,
        allowCrustChange: allowCrustChange ?? true,
        allowSauceChange: allowSauceChange ?? true,
        allowCheeseChange: allowCheeseChange ?? true,
        allowToppingMods: allowToppingMods ?? true,
      },
      include: {
        menuItem: true,
        defaultCrust: true,
        defaultSauce: true,
        defaultCheese: true,
      }
    })

    return NextResponse.json({
      ...specialty,
      toppings: specialty.toppings as Array<{
        toppingId: string
        name: string
        sections: number[]
        amount: string
      }>,
      menuItem: {
        ...specialty.menuItem,
        price: Number(specialty.menuItem.price),
      },
    })
  } catch (error) {
    console.error('Failed to create pizza specialty:', error)
    return NextResponse.json({ error: 'Failed to create pizza specialty' }, { status: 500 })
  }
})
