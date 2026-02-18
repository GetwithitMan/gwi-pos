import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - Get a single tax rule
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const taxRule = await prisma.taxRule.findUnique({ where: { id } })

    if (!taxRule) {
      return NextResponse.json({ error: 'Tax rule not found' }, { status: 404 })
    }

    return NextResponse.json({ data: {
      taxRule: {
        id: taxRule.id,
        name: taxRule.name,
        rate: Number(taxRule.rate),
        ratePercent: Number(taxRule.rate) * 100,
        appliesTo: taxRule.appliesTo,
        categoryIds: taxRule.categoryIds,
        itemIds: taxRule.itemIds,
        isInclusive: taxRule.isInclusive,
        priority: taxRule.priority,
        isCompounded: taxRule.isCompounded,
        isActive: taxRule.isActive,
      },
    } })
  } catch (error) {
    console.error('Failed to fetch tax rule:', error)
    return NextResponse.json({ error: 'Failed to fetch tax rule' }, { status: 500 })
  }
})

// PUT - Update a tax rule
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await prisma.taxRule.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Tax rule not found' }, { status: 404 })
    }

    const taxRule = await prisma.taxRule.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.rate !== undefined && { rate: body.rate / 100 }),
        ...(body.appliesTo !== undefined && { appliesTo: body.appliesTo }),
        ...(body.categoryIds !== undefined && { categoryIds: body.categoryIds }),
        ...(body.itemIds !== undefined && { itemIds: body.itemIds }),
        ...(body.isInclusive !== undefined && { isInclusive: body.isInclusive }),
        ...(body.priority !== undefined && { priority: body.priority }),
        ...(body.isCompounded !== undefined && { isCompounded: body.isCompounded }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
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
    console.error('Failed to update tax rule:', error)
    return NextResponse.json({ error: 'Failed to update tax rule' }, { status: 500 })
  }
})

// DELETE - Delete a tax rule
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const taxRule = await prisma.taxRule.findUnique({ where: { id } })
    if (!taxRule) {
      return NextResponse.json({ error: 'Tax rule not found' }, { status: 404 })
    }

    await prisma.taxRule.update({ where: { id }, data: { deletedAt: new Date() } })
    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete tax rule:', error)
    return NextResponse.json({ error: 'Failed to delete tax rule' }, { status: 500 })
  }
})
