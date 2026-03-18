import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/db'
import { dispatchMenuUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

/**
 * POST /api/liquor/bottles/[id]/restore-menu-item
 * Restore a soft-deleted menu item linked to a bottle
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bottleId } = await params

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const auth = await requirePermission(null, locationId, PERMISSIONS.MENU_EDIT_ITEMS)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Find the soft-deleted menu item for this bottle
    const deletedMenuItem = await adminDb.menuItem.findFirst({
      where: {
        linkedBottleProductId: bottleId,
        locationId,
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
    const restoredItem = await adminDb.menuItem.update({
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

    return NextResponse.json({ data: {
      success: true,
      menuItem: {
        id: restoredItem.id,
        name: restoredItem.name,
        price: Number(restoredItem.price),
        category: restoredItem.category,
      },
    } })
  } catch (error) {
    console.error('Failed to restore menu item:', error)
    return NextResponse.json(
      { error: 'Failed to restore menu item' },
      { status: 500 }
    )
  }
})
