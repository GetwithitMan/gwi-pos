import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchMenuUpdate } from '@/lib/socket-dispatch'

/**
 * POST /api/liquor/bottles/[id]/restore-menu-item
 * Restore a soft-deleted menu item linked to a bottle
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bottleId } = await params

    // Find the soft-deleted menu item for this bottle
    const deletedMenuItem = await db.menuItem.findFirst({
      where: {
        linkedBottleProductId: bottleId,
        deletedAt: { not: null },
      },
      orderBy: { deletedAt: 'desc' }, // Get most recently deleted
    })

    if (!deletedMenuItem) {
      return NextResponse.json(
        { error: 'No deleted menu item found for this bottle' },
        { status: 404 }
      )
    }

    // Restore the menu item
    const restoredItem = await db.menuItem.update({
      where: { id: deletedMenuItem.id },
      data: { deletedAt: null },
      include: {
        category: {
          select: { id: true, name: true },
        },
      },
    })

    // Dispatch socket event for real-time update
    dispatchMenuUpdate(restoredItem.locationId, {
      action: 'restored',
      menuItemId: restoredItem.id,
      bottleId: bottleId,
      name: restoredItem.name,
    }, { async: true })

    return NextResponse.json({
      success: true,
      menuItem: {
        id: restoredItem.id,
        name: restoredItem.name,
        price: Number(restoredItem.price),
        category: restoredItem.category,
      },
    })
  } catch (error) {
    console.error('Failed to restore menu item:', error)
    return NextResponse.json(
      { error: 'Failed to restore menu item' },
      { status: 500 }
    )
  }
}
