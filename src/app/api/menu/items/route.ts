import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      name,
      price,
      description,
      categoryId,
      commissionType,
      commissionValue,
      availableFrom,
      availableTo,
      availableDays,
      // Pour size options for liquor items
      pourSizes,
      defaultPourSize,
      applyPourToModifiers,
      // Printer routing
      printerIds,
      backupPrinterIds,
      // Combo print mode
      comboPrintMode,
    } = body

    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      )
    }

    if (price === undefined || price < 0) {
      return NextResponse.json(
        { error: 'Valid price is required' },
        { status: 400 }
      )
    }

    // Get the location from the category
    const category = await db.category.findUnique({
      where: { id: categoryId },
      select: { locationId: true }
    })

    if (!category) {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 400 }
      )
    }

    // Get max sort order in category
    const maxSortOrder = await db.menuItem.aggregate({
      where: { categoryId },
      _max: { sortOrder: true }
    })

    const item = await db.menuItem.create({
      data: {
        locationId: category.locationId,
        categoryId,
        name: name.trim(),
        price,
        description: description || null,
        sortOrder: (maxSortOrder._max.sortOrder || 0) + 1,
        commissionType: commissionType || null,
        commissionValue: commissionValue ?? null,
        availableFrom: availableFrom || null,
        availableTo: availableTo || null,
        availableDays: availableDays || null,
        // Pour size options
        pourSizes: pourSizes || null,
        defaultPourSize: defaultPourSize || null,
        applyPourToModifiers: applyPourToModifiers || false,
        // Printer routing
        printerIds: printerIds && printerIds.length > 0 ? printerIds : null,
        backupPrinterIds: backupPrinterIds && backupPrinterIds.length > 0 ? backupPrinterIds : null,
        // Combo print mode
        comboPrintMode: comboPrintMode || null,
      }
    })

    return NextResponse.json({
      id: item.id,
      categoryId: item.categoryId,
      name: item.name,
      price: Number(item.price),
      description: item.description,
      isActive: item.isActive,
      isAvailable: item.isAvailable,
      commissionType: item.commissionType,
      commissionValue: item.commissionValue ? Number(item.commissionValue) : null,
      availableFrom: item.availableFrom,
      availableTo: item.availableTo,
      availableDays: item.availableDays,
      printerIds: item.printerIds,
      backupPrinterIds: item.backupPrinterIds,
      comboPrintMode: item.comboPrintMode,
    })
  } catch (error) {
    console.error('Failed to create item:', error)
    return NextResponse.json(
      { error: 'Failed to create item' },
      { status: 500 }
    )
  }
}
