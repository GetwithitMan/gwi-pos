import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

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
      description,
      isAvailable,
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
        ...(description !== undefined && { description }),
        ...(isAvailable !== undefined && { isAvailable }),
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
