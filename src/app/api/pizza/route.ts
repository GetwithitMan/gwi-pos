import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'

// GET /api/pizza - Get all pizza builder data at once (for PizzaBuilderModal)
export const GET = withVenue(async function GET() {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Fetch all pizza data in parallel
    const [config, sizes, crusts, sauces, cheeses, toppings, printers] = await Promise.all([
      // Config (create default if doesn't exist)
      db.pizzaConfig.upsert({
        where: { locationId },
        update: {},
        create: {
          locationId,
          maxSections: 8,
          defaultSections: 2,
          sectionOptions: [1, 2, 4, 8],
          pricingMode: 'fractional',
          freeToppingsEnabled: false,
          freeToppingsCount: 0,
          freeToppingsMode: 'per_pizza',
          showVisualBuilder: true,
          showToppingList: true,
          defaultToListView: false,
        }
      }),
      // Sizes
      db.pizzaSize.findMany({
        where: { locationId, isActive: true },
        orderBy: { sortOrder: 'asc' }
      }),
      // Crusts
      db.pizzaCrust.findMany({
        where: { locationId, isActive: true },
        orderBy: { sortOrder: 'asc' }
      }),
      // Sauces
      db.pizzaSauce.findMany({
        where: { locationId, isActive: true },
        orderBy: { sortOrder: 'asc' }
      }),
      // Cheeses
      db.pizzaCheese.findMany({
        where: { locationId, isActive: true },
        orderBy: { sortOrder: 'asc' }
      }),
      // Toppings
      db.pizzaTopping.findMany({
        where: { locationId, isActive: true },
        orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }]
      }),
      // Printers (for admin UI)
      db.printer.findMany({
        where: { locationId, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, printerRole: true }
      }),
    ])

    // Group toppings by category
    const toppingsByCategory: Record<string, typeof toppings> = {}
    for (const topping of toppings) {
      const cat = topping.category || 'standard'
      if (!toppingsByCategory[cat]) {
        toppingsByCategory[cat] = []
      }
      toppingsByCategory[cat].push(topping)
    }

    return NextResponse.json({
      config: {
        ...config,
        sectionOptions: config.sectionOptions as number[],
        hybridPricing: config.hybridPricing as Record<string, number> | null,
        extraToppingPrice: config.extraToppingPrice ? Number(config.extraToppingPrice) : null,
        printerIds: (config.printerIds as string[]) || [],
        printSettings: config.printSettings,
      },
      printers,
      sizes: sizes.map(s => ({
        ...s,
        basePrice: Number(s.basePrice),
        priceMultiplier: Number(s.priceMultiplier),
        toppingMultiplier: Number(s.toppingMultiplier),
      })),
      crusts: crusts.map(c => ({
        ...c,
        price: Number(c.price),
      })),
      sauces: sauces.map(s => ({
        ...s,
        price: Number(s.price),
        extraPrice: Number(s.extraPrice),
      })),
      cheeses: cheeses.map(c => ({
        ...c,
        price: Number(c.price),
        extraPrice: Number(c.extraPrice),
      })),
      toppings: toppings.map(t => ({
        ...t,
        price: Number(t.price),
        extraPrice: t.extraPrice ? Number(t.extraPrice) : null,
      })),
      toppingsByCategory: Object.fromEntries(
        Object.entries(toppingsByCategory).map(([cat, tops]) => [
          cat,
          tops.map(t => ({
            ...t,
            price: Number(t.price),
            extraPrice: t.extraPrice ? Number(t.extraPrice) : null,
          }))
        ])
      ),
      // Category order for display
      toppingCategories: ['meat', 'veggie', 'cheese', 'premium', 'seafood', 'standard'].filter(
        cat => toppingsByCategory[cat]?.length > 0
      ),
    })
  } catch (error) {
    console.error('Failed to get pizza data:', error)
    return NextResponse.json({ error: 'Failed to get pizza data' }, { status: 500 })
  }
})
