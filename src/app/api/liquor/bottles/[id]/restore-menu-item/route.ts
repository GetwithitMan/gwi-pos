import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { dispatchMenuUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

/**
 * POST /api/liquor/bottles/[id]/restore-menu-item
 * Restore a soft-deleted menu item linked to a bottle
 */
export const POST = withVenue(withAuth('ADMIN', async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bottleId } = await params

    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const auth = await requirePermission(null, locationId, PERMISSIONS.MENU_EDIT_ITEMS)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Find the soft-deleted menu item for this bottle
    const deletedMenuItem = await db.menuItem.findFirst({
      where: {
        linkedBottleProductId: bottleId,
        locationId,
        deletedAt: { not: null },
      },
      orderBy: { deletedAt: 'desc' }, // Get most recently deleted
    })

    if (!deletedMenuItem) {
      return notFound('No deleted menu item found for this bottle')
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

    pushUpstream()

    // Dispatch socket event for real-time update
    dispatchMenuUpdate(restoredItem.locationId, {
      action: 'restored',
      menuItemId: restoredItem.id,
      bottleId: bottleId,
      name: restoredItem.name,
    }, { async: true })

    return ok({
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
    return err('Failed to restore menu item', 500)
  }
}))
