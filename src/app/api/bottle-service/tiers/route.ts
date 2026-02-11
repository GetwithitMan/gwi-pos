import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - List bottle service tiers for a location
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json({ error: 'Missing locationId' }, { status: 400 })
    }

    const tiers = await db.bottleServiceTier.findMany({
      where: { locationId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    })

    return NextResponse.json({
      data: tiers.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        color: t.color,
        depositAmount: Number(t.depositAmount),
        minimumSpend: Number(t.minimumSpend),
        autoGratuityPercent: t.autoGratuityPercent ? Number(t.autoGratuityPercent) : null,
        sortOrder: t.sortOrder,
        isActive: t.isActive,
      })),
    })
  } catch (error) {
    console.error('Failed to list bottle service tiers:', error)
    return NextResponse.json({ error: 'Failed to list bottle service tiers' }, { status: 500 })
  }
}

// POST - Create a new bottle service tier
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, name, description, color, depositAmount, minimumSpend, autoGratuityPercent, sortOrder } = body

    if (!locationId || !name || depositAmount == null || minimumSpend == null) {
      return NextResponse.json({ error: 'Missing required fields: locationId, name, depositAmount, minimumSpend' }, { status: 400 })
    }

    const tier = await db.bottleServiceTier.create({
      data: {
        locationId,
        name,
        description,
        color: color || '#D4AF37',
        depositAmount,
        minimumSpend,
        autoGratuityPercent: autoGratuityPercent ?? null,
        sortOrder: sortOrder ?? 0,
      },
    })

    return NextResponse.json({
      data: {
        id: tier.id,
        name: tier.name,
        description: tier.description,
        color: tier.color,
        depositAmount: Number(tier.depositAmount),
        minimumSpend: Number(tier.minimumSpend),
        autoGratuityPercent: tier.autoGratuityPercent ? Number(tier.autoGratuityPercent) : null,
        sortOrder: tier.sortOrder,
        isActive: tier.isActive,
      },
    })
  } catch (error) {
    console.error('Failed to create bottle service tier:', error)
    return NextResponse.json({ error: 'Failed to create bottle service tier' }, { status: 500 })
  }
}
