import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchMenuItemChanged, dispatchMenuStockChanged } from '@/lib/socket-dispatch'

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
        displayName: item.displayName,
        price: Number(item.price),
        priceCC: item.priceCC ? Number(item.priceCC) : null,
        cost: item.cost ? Number(item.cost) : null,
        description: item.description,
        sku: item.sku,
        isActive: item.isActive,
        isAvailable: item.isAvailable,
        showOnPOS: item.showOnPOS,
        showOnline: item.showOnline,
        itemType: item.itemType,
        isPizza: isPizzaItem,
        hasModifiers: item.modifierGroups.length > 0 || isPizzaItem,
        modifierGroups: item.modifierGroups,
        // Tax
        taxRate: item.taxRate ? Number(item.taxRate) : null,
        isTaxExempt: item.isTaxExempt,
        // Kitchen
        prepTime: item.prepTime,
        courseNumber: item.courseNumber,
        prepStationId: item.prepStationId,
        // Inventory
        trackInventory: item.trackInventory,
        lowStockAlert: item.lowStockAlert,
        // Commission
        commissionType: item.commissionType,
        commissionValue: item.commissionValue ? Number(item.commissionValue) : null,
        // Availability schedule
        availableFrom: item.availableFrom,
        availableTo: item.availableTo,
        availableDays: item.availableDays,
        // Happy Hour
        happyHourEnabled: item.happyHourEnabled,
        happyHourDiscount: item.happyHourDiscount,
        happyHourStart: item.happyHourStart,
        happyHourEnd: item.happyHourEnd,
        happyHourDays: item.happyHourDays,
        // Entertainment/timed rental fields
        entertainmentStatus: item.itemType === 'timed_rental' ? (item.entertainmentStatus || 'available') : null,
        blockTimeMinutes: item.itemType === 'timed_rental' ? item.blockTimeMinutes : null,
        timedPricing: item.itemType === 'timed_rental' ? item.timedPricing : null,
        pourSizes: item.pourSizes,
        defaultPourSize: item.defaultPourSize,
        imageUrl: item.imageUrl,
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
      displayName,
      price,
      priceCC,
      cost,
      description,
      sku,
      imageUrl,
      isActive,
      isAvailable,
      showOnPOS,
      showOnline,
      sortOrder,
      deletedAt,
      // Tax
      taxRate,
      isTaxExempt,
      // Kitchen
      prepTime,
      courseNumber,
      prepStationId,
      // Inventory
      trackInventory,
      lowStockAlert,
      // Commission
      commissionType,
      commissionValue,
      // Availability schedule
      availableFrom,
      availableTo,
      availableDays,
      // Happy Hour
      happyHourEnabled,
      happyHourDiscount,
      happyHourStart,
      happyHourEnd,
      happyHourDays,
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

    // Get old item to detect stock changes
    const oldItem = await db.menuItem.findUnique({
      where: { id },
      select: { isAvailable: true, locationId: true }
    })

    const item = await db.menuItem.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(displayName !== undefined && { displayName: displayName || null }),
        ...(price !== undefined && { price }),
        ...(priceCC !== undefined && { priceCC: priceCC || null }),
        ...(cost !== undefined && { cost: cost ?? null }),
        ...(description !== undefined && { description }),
        ...(sku !== undefined && { sku: sku || null }),
        ...(imageUrl !== undefined && { imageUrl: imageUrl || null }),
        ...(isActive !== undefined && { isActive }),
        ...(isAvailable !== undefined && { isAvailable }),
        ...(showOnPOS !== undefined && { showOnPOS }),
        ...(showOnline !== undefined && { showOnline }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(deletedAt !== undefined && { deletedAt: deletedAt ? new Date(deletedAt) : null }),
        // Tax
        ...(taxRate !== undefined && { taxRate: taxRate ?? null }),
        ...(isTaxExempt !== undefined && { isTaxExempt }),
        // Kitchen
        ...(prepTime !== undefined && { prepTime: prepTime ?? null }),
        ...(courseNumber !== undefined && { courseNumber: courseNumber ?? null }),
        ...(prepStationId !== undefined && { prepStationId: prepStationId || null }),
        // Inventory
        ...(trackInventory !== undefined && { trackInventory }),
        ...(lowStockAlert !== undefined && { lowStockAlert: lowStockAlert ?? null }),
        // Commission
        ...(commissionType !== undefined && { commissionType: commissionType || null }),
        ...(commissionValue !== undefined && { commissionValue: commissionValue ?? null }),
        // Availability
        ...(availableFrom !== undefined && { availableFrom: availableFrom || null }),
        ...(availableTo !== undefined && { availableTo: availableTo || null }),
        ...(availableDays !== undefined && { availableDays: availableDays || null }),
        // Happy Hour
        ...(happyHourEnabled !== undefined && { happyHourEnabled }),
        ...(happyHourDiscount !== undefined && { happyHourDiscount: happyHourDiscount ?? null }),
        ...(happyHourStart !== undefined && { happyHourStart: happyHourStart || null }),
        ...(happyHourEnd !== undefined && { happyHourEnd: happyHourEnd || null }),
        ...(happyHourDays !== undefined && { happyHourDays: happyHourDays || null }),
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

    // Dispatch socket events for real-time updates
    const action = deletedAt ? 'deleted' : (item.deletedAt === null && deletedAt === undefined) ? 'updated' : 'restored'

    // Dispatch item changed event
    dispatchMenuItemChanged(item.locationId, {
      itemId: item.id,
      action,
      changes: {
        name: item.name,
        price: Number(item.price),
        isActive: item.isActive,
        isAvailable: item.isAvailable,
      }
    }, { async: true }).catch(err => {
      console.error('Failed to dispatch menu item changed event:', err)
    })

    // If stock status changed (isAvailable), dispatch stock change event
    if (oldItem && isAvailable !== undefined && oldItem.isAvailable !== isAvailable) {
      const stockStatus = isAvailable ? 'in_stock' : 'out_of_stock'
      dispatchMenuStockChanged(item.locationId, {
        itemId: item.id,
        stockStatus,
        isOrderableOnline: isAvailable, // For now, simple logic
      }, { async: true }).catch(err => {
        console.error('Failed to dispatch stock changed event:', err)
      })
    }

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

    // Get item info before deletion for socket dispatch
    const item = await db.menuItem.findUnique({
      where: { id },
      select: { locationId: true }
    })

    await db.menuItem.delete({ where: { id } })

    // Dispatch socket event for real-time update
    if (item) {
      dispatchMenuItemChanged(item.locationId, {
        itemId: id,
        action: 'deleted',
      }, { async: true }).catch(err => {
        console.error('Failed to dispatch menu item deleted event:', err)
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete item:', error)
    return NextResponse.json(
      { error: 'Failed to delete item' },
      { status: 500 }
    )
  }
}
