import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchMenuUpdate } from '@/lib/socket-dispatch'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const item = await db.menuItem.findFirst({
      where: { id, deletedAt: null },
      include: {
        category: {
          select: { id: true, name: true, categoryType: true },
        },
        modifierGroups: {
          where: { modifierGroup: { deletedAt: null } },
          select: { modifierGroupId: true },
        },
      },
    })

    if (!item) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 }
      )
    }

    // Check if this is a pizza item based on category type OR item type
    const isPizzaItem = item.itemType === 'pizza' || item.category?.categoryType === 'pizza'

    return NextResponse.json({
      item: {
        id: item.id,
        categoryId: item.categoryId,
        categoryName: item.category?.name,
        categoryType: item.category?.categoryType,
        name: item.name,
        price: Number(item.price),
        priceCC: item.priceCC ? Number(item.priceCC) : null,
        description: item.description,
        isActive: item.isActive,
        isAvailable: item.isAvailable,
        itemType: item.itemType,
        isPizza: isPizzaItem,
        hasModifiers: item.modifierGroups.length > 0 || isPizzaItem,
        modifierGroups: item.modifierGroups,
        // Entertainment/timed rental fields
        entertainmentStatus: item.itemType === 'timed_rental' ? (item.entertainmentStatus || 'available') : null,
        blockTimeMinutes: item.itemType === 'timed_rental' ? item.blockTimeMinutes : null,
        timedPricing: item.itemType === 'timed_rental' ? item.timedPricing : null,
        pourSizes: item.pourSizes,
        defaultPourSize: item.defaultPourSize,
      },
    })
  } catch (error) {
    console.error('Failed to get item:', error)
    return NextResponse.json(
      { error: 'Failed to get item' },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const {
      name,
      price,
      priceCC,
      description,
      isActive,
      isAvailable,
      showOnPOS,
      sortOrder,
      deletedAt,
      commissionType,
      commissionValue,
      availableFrom,
      availableTo,
      availableDays,
      // Pour size options
      pourSizes,
      defaultPourSize,
      applyPourToModifiers,
      // Printer routing (arrays)
      printerIds,
      backupPrinterIds,
      // Combo print mode
      comboPrintMode,
    } = body

    const item = await db.menuItem.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(price !== undefined && { price }),
        ...(priceCC !== undefined && { priceCC: priceCC || null }),
        ...(description !== undefined && { description }),
        ...(isActive !== undefined && { isActive }),
        ...(isAvailable !== undefined && { isAvailable }),
        ...(showOnPOS !== undefined && { showOnPOS }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(deletedAt !== undefined && { deletedAt: deletedAt ? new Date(deletedAt) : null }),
        ...(commissionType !== undefined && { commissionType: commissionType || null }),
        ...(commissionValue !== undefined && { commissionValue: commissionValue ?? null }),
        ...(availableFrom !== undefined && { availableFrom: availableFrom || null }),
        ...(availableTo !== undefined && { availableTo: availableTo || null }),
        ...(availableDays !== undefined && { availableDays: availableDays || null }),
        // Pour size options
        ...(pourSizes !== undefined && { pourSizes: pourSizes || null }),
        ...(defaultPourSize !== undefined && { defaultPourSize: defaultPourSize || null }),
        ...(applyPourToModifiers !== undefined && { applyPourToModifiers }),
        // Printer routing - arrays of printer IDs
        ...(printerIds !== undefined && {
          printerIds: printerIds && printerIds.length > 0 ? printerIds : null
        }),
        ...(backupPrinterIds !== undefined && {
          backupPrinterIds: backupPrinterIds && backupPrinterIds.length > 0 ? backupPrinterIds : null
        }),
        // Combo print mode
        ...(comboPrintMode !== undefined && { comboPrintMode: comboPrintMode || null }),
      }
    })

    // Dispatch socket event for real-time update
    const action = deletedAt ? 'deleted' : (item.deletedAt === null && deletedAt === undefined) ? 'updated' : 'restored'
    dispatchMenuUpdate(item.locationId, {
      action,
      menuItemId: item.id,
      bottleId: item.linkedBottleProductId || undefined,
      name: item.name,
    }, { async: true })

    return NextResponse.json({
      id: item.id,
      categoryId: item.categoryId,
      name: item.name,
      price: Number(item.price),
      priceCC: item.priceCC ? Number(item.priceCC) : null,
      description: item.description,
      isActive: item.isActive,
      isAvailable: item.isAvailable,
      commissionType: item.commissionType,
      commissionValue: item.commissionValue ? Number(item.commissionValue) : null,
      availableFrom: item.availableFrom,
      availableTo: item.availableTo,
      availableDays: item.availableDays,
      pourSizes: item.pourSizes,
      defaultPourSize: item.defaultPourSize,
      applyPourToModifiers: item.applyPourToModifiers,
      printerIds: item.printerIds,
      backupPrinterIds: item.backupPrinterIds,
      comboPrintMode: item.comboPrintMode,
    })
  } catch (error) {
    console.error('Failed to update item:', error)
    return NextResponse.json(
      { error: 'Failed to update item' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    await db.menuItem.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete item:', error)
    return NextResponse.json(
      { error: 'Failed to delete item' },
      { status: 500 }
    )
  }
}
