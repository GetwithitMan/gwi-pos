import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - List tax rules
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const taxRules = await prisma.taxRule.findMany({
      where: { locationId },
      orderBy: { priority: 'asc' },
    })

    return NextResponse.json({ data: {
      taxRules: taxRules.map(r => ({
        id: r.id,
        name: r.name,
        rate: Number(r.rate),
        ratePercent: Number(r.rate) * 100,
        appliesTo: r.appliesTo,
        categoryIds: r.categoryIds,
        itemIds: r.itemIds,
        isInclusive: r.isInclusive,
        priority: r.priority,
        isCompounded: r.isCompounded,
        isActive: r.isActive,
      })),
    } })
  } catch (error) {
    console.error('Tax rules error:', error)
    return NextResponse.json({ error: 'Failed to fetch tax rules' }, { status: 500 })
  }
})

// POST - Create tax rule
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      rate,
      appliesTo,
      categoryIds,
      itemIds,
      isInclusive,
      priority,
      isCompounded,
    } = body

    if (!locationId || !name || rate === undefined) {
      return NextResponse.json({ error: 'Location ID, name, and rate required' }, { status: 400 })
    }

    const taxRule = await prisma.taxRule.create({
      data: {
        locationId,
        name,
        rate: rate / 100, // Convert percent to decimal
        appliesTo: appliesTo || 'all',
        categoryIds: categoryIds || null,
        itemIds: itemIds || null,
        isInclusive: isInclusive ?? false,
        priority: priority ?? 0,
        isCompounded: isCompounded ?? false,
      },
    })

    return NextResponse.json({ data: {
      taxRule: {
        id: taxRule.id,
        name: taxRule.name,
        rate: Number(taxRule.rate),
        ratePercent: Number(taxRule.rate) * 100,
        appliesTo: taxRule.appliesTo,
        isActive: taxRule.isActive,
      },
    } })
  } catch (error) {
    console.error('Create tax rule error:', error)
    return NextResponse.json({ error: 'Failed to create tax rule' }, { status: 500 })
  }
})
