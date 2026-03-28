import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

// GET /api/pizza/specialties - Get all specialty pizzas (supports ?menuItemId= filter)
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const { searchParams } = new URL(request.url)
    const menuItemId = searchParams.get('menuItemId')

    const specialties = await db.pizzaSpecialty.findMany({
      where: {
        locationId,
        deletedAt: null,
        ...(menuItemId ? { menuItemId } : {}),
      },
      include: {
        menuItem: true,
        defaultCrust: true,
        defaultSauce: true,
        defaultCheese: true,
      },
      orderBy: { menuItem: { sortOrder: 'asc' } }
    })

    return ok(specialties.map(specialty => ({
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
    return err('Failed to get pizza specialties', 500)
  }
})

// POST /api/pizza/specialties - Create specialty pizza
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
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
      return err('Menu item ID is required')
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Verify menu item exists and is a pizza
    const menuItem = await db.menuItem.findFirst({
      where: { id: menuItemId, locationId },
      include: { category: true }
    })

    if (!menuItem) {
      return notFound('Menu item not found')
    }

    if (menuItem.itemType !== 'pizza' && menuItem.category?.categoryType !== 'pizza') {
      return err('Menu item must be a pizza type')
    }

    // Check if specialty already exists for this menu item
    const existing = await db.pizzaSpecialty.findUnique({
      where: { menuItemId }
    })

    if (existing) {
      return err('Specialty already exists for this menu item')
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
        lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
      },
      include: {
        menuItem: true,
        defaultCrust: true,
        defaultSauce: true,
        defaultCheese: true,
      }
    })
    pushUpstream()

    return ok({
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
    return err('Failed to create pizza specialty', 500)
  }
}))
