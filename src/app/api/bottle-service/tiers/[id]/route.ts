import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - Get a single bottle service tier
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const tier = await db.bottleServiceTier.findFirst({
      where: { id, deletedAt: null },
    })

    if (!tier) {
      return NextResponse.json({ error: 'Tier not found' }, { status: 404 })
    }

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
    console.error('Failed to get bottle service tier:', error)
    return NextResponse.json({ error: 'Failed to get bottle service tier' }, { status: 500 })
  }
}

// PUT - Update a bottle service tier
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, description, color, depositAmount, minimumSpend, autoGratuityPercent, sortOrder, isActive } = body

    const existing = await db.bottleServiceTier.findFirst({
      where: { id, deletedAt: null },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Tier not found' }, { status: 404 })
    }

    const tier = await db.bottleServiceTier.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(color !== undefined && { color }),
        ...(depositAmount !== undefined && { depositAmount }),
        ...(minimumSpend !== undefined && { minimumSpend }),
        ...(autoGratuityPercent !== undefined && { autoGratuityPercent }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(isActive !== undefined && { isActive }),
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
    console.error('Failed to update bottle service tier:', error)
    return NextResponse.json({ error: 'Failed to update bottle service tier' }, { status: 500 })
  }
}

// DELETE - Soft delete a bottle service tier
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await db.bottleServiceTier.findFirst({
      where: { id, deletedAt: null },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Tier not found' }, { status: 404 })
    }

    await db.bottleServiceTier.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete bottle service tier:', error)
    return NextResponse.json({ error: 'Failed to delete bottle service tier' }, { status: 500 })
  }
}
