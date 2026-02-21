import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getEffectiveCost, toNumber } from '@/lib/inventory-calculations'
import { createModifierInventoryLinkSchema, validateRequest } from '@/lib/validations'
import { withVenue } from '@/lib/with-venue'
import { areUnitsCompatible, getUnitCategory } from '@/lib/inventory/unit-conversion'

// GET - Get inventory link for modifier
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const modifier = await db.modifier.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        price: true,
        inventoryLink: {
          include: {
            inventoryItem: {
              select: {
                id: true,
                name: true,
                storageUnit: true,
                costPerUnit: true,
                yieldCostPerUnit: true,
              },
            },
          },
        },
      },
    })

    if (!modifier) {
      return NextResponse.json({ error: 'Modifier not found' }, { status: 404 })
    }

    if (!modifier.inventoryLink) {
      return NextResponse.json({ data: {
        modifier: {
          id: modifier.id,
          name: modifier.name,
          price: toNumber(modifier.price),
        },
        inventoryLink: null
      } })
    }

    const link = modifier.inventoryLink
    const unitCost = link.inventoryItem ? getEffectiveCost(link.inventoryItem) : 0
    const totalCost = toNumber(link.usageQuantity) * unitCost

    return NextResponse.json({ data: {
      modifier: {
        id: modifier.id,
        name: modifier.name,
        price: toNumber(modifier.price),
      },
      inventoryLink: {
        id: link.id,
        modifierId: link.modifierId,
        inventoryItemId: link.inventoryItemId,
        usageQuantity: toNumber(link.usageQuantity),
        usageUnit: link.usageUnit,
        inventoryItem: link.inventoryItem,
        unitCost,
        totalCost,
      },
    } })
  } catch (error) {
    console.error('Get modifier inventory link error:', error)
    return NextResponse.json({ error: 'Failed to fetch inventory link' }, { status: 500 })
  }
})

// POST - Create or update inventory link for modifier
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    // Validate request body
    const validation = validateRequest(createModifierInventoryLinkSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const { inventoryItemId, usageQuantity, usageUnit } = validation.data

    // Get modifier and inventory item in parallel
    const [modifier, inventoryItem] = await Promise.all([
      db.modifier.findUnique({
        where: { id },
        select: { id: true, name: true, price: true, locationId: true },
      }),
      db.inventoryItem.findUnique({
        where: { id: inventoryItemId },
        select: {
          id: true,
          name: true,
          storageUnit: true,
          costPerUnit: true,
          yieldCostPerUnit: true
        },
      }),
    ])

    if (!modifier) {
      return NextResponse.json({ error: 'Modifier not found' }, { status: 404 })
    }

    if (!inventoryItem) {
      return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 })
    }

    // Check for cross-category unit mismatch (e.g. volume usageUnit vs weight storageUnit)
    let unitWarning: string | undefined
    if (!areUnitsCompatible(usageUnit, inventoryItem.storageUnit)) {
      const usageCategory = getUnitCategory(usageUnit)
      const storageCategory = getUnitCategory(inventoryItem.storageUnit)
      unitWarning = `Unit mismatch: usageUnit (${usageUnit}) is ${usageCategory ?? 'unknown'} but storageUnit (${inventoryItem.storageUnit}) is ${storageCategory ?? 'unknown'}. Deduction will use raw quantity without conversion.`
    }

    // Use transaction for atomic upsert
    const link = await db.$transaction(async (tx) => {
      // Check if link already exists
      const existingLink = await tx.modifierInventoryLink.findUnique({
        where: { modifierId: id },
      })

      if (existingLink) {
        return tx.modifierInventoryLink.update({
          where: { id: existingLink.id },
          data: {
            inventoryItemId,
            usageQuantity,
            usageUnit,
          },
          include: {
            inventoryItem: {
              select: {
                id: true,
                name: true,
                storageUnit: true,
                costPerUnit: true,
                yieldCostPerUnit: true,
              },
            },
          },
        })
      } else {
        return tx.modifierInventoryLink.create({
          data: {
            locationId: modifier.locationId,
            modifierId: id,
            inventoryItemId,
            usageQuantity,
            usageUnit,
          },
          include: {
            inventoryItem: {
              select: {
                id: true,
                name: true,
                storageUnit: true,
                costPerUnit: true,
                yieldCostPerUnit: true,
              },
            },
          },
        })
      }
    })

    const unitCost = link.inventoryItem ? getEffectiveCost(link.inventoryItem) : 0
    const totalCost = toNumber(link.usageQuantity) * unitCost

    // Update the calculated cost on the link
    await db.modifierInventoryLink.update({
      where: { id: link.id },
      data: { calculatedCost: totalCost },
    })

    return NextResponse.json({
      data: {
        modifier: {
          id: modifier.id,
          name: modifier.name,
          price: toNumber(modifier.price),
        },
        inventoryLink: {
          id: link.id,
          modifierId: link.modifierId,
          inventoryItemId: link.inventoryItemId,
          usageQuantity: toNumber(link.usageQuantity),
          usageUnit: link.usageUnit,
          inventoryItem: link.inventoryItem,
          unitCost,
          totalCost,
        },
      },
      ...(unitWarning ? { warning: unitWarning } : {}),
    })
  } catch (error) {
    console.error('Save modifier inventory link error:', error)
    return NextResponse.json({ error: 'Failed to save inventory link' }, { status: 500 })
  }
})

// DELETE - Remove inventory link from modifier
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const link = await db.modifierInventoryLink.findUnique({
      where: { modifierId: id },
    })

    if (!link) {
      return NextResponse.json({ error: 'Inventory link not found' }, { status: 404 })
    }

    await db.modifierInventoryLink.update({
      where: { id: link.id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Delete modifier inventory link error:', error)
    return NextResponse.json({ error: 'Failed to delete inventory link' }, { status: 500 })
  }
})
