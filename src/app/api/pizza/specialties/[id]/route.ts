import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'

// GET /api/pizza/specialties/[id] - Get single specialty pizza
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const specialty = await db.pizzaSpecialty.findUnique({
      where: { id },
      include: {
        menuItem: true,
        defaultCrust: true,
        defaultSauce: true,
        defaultCheese: true,
      }
    })

    if (!specialty) {
      return NextResponse.json({ error: 'Specialty not found' }, { status: 404 })
    }

    return NextResponse.json({ data: {
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
    } })
  } catch (error) {
    console.error('Failed to get pizza specialty:', error)
    return NextResponse.json({ error: 'Failed to get pizza specialty' }, { status: 500 })
  }
})

// PATCH /api/pizza/specialties/[id] - Update specialty pizza
export const PATCH = withVenue(withAuth('ADMIN', async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const existing = await db.pizzaSpecialty.findUnique({ where: { id } })
    if (!existing || existing.locationId !== locationId) {
      return NextResponse.json({ error: 'Specialty not found' }, { status: 404 })
    }

    const specialty = await db.pizzaSpecialty.update({
      where: { id },
      data: {
        ...(body.defaultCrustId !== undefined && { defaultCrustId: body.defaultCrustId }),
        ...(body.defaultSauceId !== undefined && { defaultSauceId: body.defaultSauceId }),
        ...(body.defaultCheeseId !== undefined && { defaultCheeseId: body.defaultCheeseId }),
        ...(body.sauceAmount !== undefined && { sauceAmount: body.sauceAmount }),
        ...(body.cheeseAmount !== undefined && { cheeseAmount: body.cheeseAmount }),
        ...(body.toppings !== undefined && { toppings: body.toppings }),
        ...(body.allowSizeChange !== undefined && { allowSizeChange: body.allowSizeChange }),
        ...(body.allowCrustChange !== undefined && { allowCrustChange: body.allowCrustChange }),
        ...(body.allowSauceChange !== undefined && { allowSauceChange: body.allowSauceChange }),
        ...(body.allowCheeseChange !== undefined && { allowCheeseChange: body.allowCheeseChange }),
        ...(body.allowToppingMods !== undefined && { allowToppingMods: body.allowToppingMods }),
        lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
      },
      include: {
        menuItem: true,
        defaultCrust: true,
        defaultSauce: true,
        defaultCheese: true,
      }
    })

    return NextResponse.json({ data: {
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
    } })
  } catch (error) {
    console.error('Failed to update pizza specialty:', error)
    return NextResponse.json({ error: 'Failed to update pizza specialty' }, { status: 500 })
  }
}))

// DELETE /api/pizza/specialties/[id] - Delete specialty pizza
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const existing = await db.pizzaSpecialty.findUnique({ where: { id } })
    if (!existing || existing.locationId !== locationId) {
      return NextResponse.json({ error: 'Specialty not found' }, { status: 404 })
    }

    await db.pizzaSpecialty.update({
      where: { id },
      data: { deletedAt: new Date(), lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local' },
    })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete pizza specialty:', error)
    return NextResponse.json({ error: 'Failed to delete pizza specialty' }, { status: 500 })
  }
}))
