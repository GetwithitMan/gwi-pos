/**
 * Order Ownership API (Skill 253)
 *
 * GET    - Get active ownership for an order
 * POST   - Add an owner to an order
 * PUT    - Update ownership split percentages
 * DELETE - Remove an owner from an order
 */

import { NextRequest } from 'next/server'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import {
  getActiveOwnership,
  addOrderOwner,
  removeOrderOwner,
  updateOwnershipSplits,
} from '@/lib/domain/tips/table-ownership'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { dispatchOrderUpdated } from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { getRequestLocationId } from '@/lib/request-context'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, forbidden, notFound, ok, unauthorized } from '@/lib/api-response'

const log = createChildLogger('orders.id.ownership')

type RouteContext = { params: Promise<{ id: string }> }

// ─── GET: Get active ownership for an order ─────────────────────────────────

export const GET = withVenue(withAuth({ allowCellular: true }, async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id: orderId } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return err('locationId is required')
    }

    if (!orderId) {
      return err('orderId is required')
    }

    // Auth: any authenticated employee can view ownership
    const requestingEmployeeId = request.headers.get('x-employee-id')
    if (!requestingEmployeeId) {
      return unauthorized('Employee ID is required')
    }

    const ownership = await getActiveOwnership(orderId)

    return ok({ ownership })
  } catch (error) {
    console.error('Failed to get order ownership:', error)
    return err('Failed to get order ownership', 500)
  }
}))

// ─── POST: Add an owner to an order ─────────────────────────────────────────

export const POST = withVenue(withAuth({ allowCellular: true }, async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { id: orderId } = await params
    const body = await request.json()
    const { locationId, employeeId, splitType, customPercent } = body

    // ── Validate required fields ────────────────────────────────────────

    if (!locationId) {
      return err('locationId is required')
    }

    if (!orderId) {
      return err('orderId is required')
    }

    if (!employeeId) {
      return err('employeeId is required')
    }

    if (!splitType || (splitType !== 'even' && splitType !== 'custom')) {
      return err('splitType must be "even" or "custom"')
    }

    if (splitType === 'custom' && (customPercent === undefined || customPercent === null)) {
      return err('customPercent is required when splitType is "custom"')
    }

    // ── Auth check ──────────────────────────────────────────────────────
    // Allowed: self-add, order owner adding co-owners, or manager with tip permission
    const requestingEmployeeId = request.headers.get('x-employee-id')
    if (!requestingEmployeeId) {
      return unauthorized('Employee ID is required')
    }

    const isSelfAdd = requestingEmployeeId === employeeId

    if (!isSelfAdd) {
      // Check if the requesting employee owns this order (table/tab creator)
      const { db: database } = await import('@/lib/db')
      const order = await database.order.findUnique({
        where: { id: orderId },
        select: { employeeId: true },
      })
      const isOrderOwner = order?.employeeId === requestingEmployeeId

      if (!isOrderOwner) {
        const auth = await requireAnyPermission(
          requestingEmployeeId,
          locationId,
          [PERMISSIONS.TIPS_MANAGE_GROUPS]
        )
        if (!auth.authorized) {
          return forbidden('Not authorized. Only the table owner or a manager can add co-owners.')
        }
      }
    }

    // ── Add owner ───────────────────────────────────────────────────────
    const ownership = await addOrderOwner({
      locationId,
      orderId,
      employeeId,
      createdById: requestingEmployeeId!,
      splitType,
      customPercent,
    })

    // Emit order event for ownership change
    void emitOrderEvent(locationId, orderId, 'ORDER_METADATA_UPDATED', {
      employeeId,
      ownershipAction: 'owner_added',
      splitType,
    }).catch(err => console.error('[ownership] Failed to emit ORDER_METADATA_UPDATED event:', err))

    pushUpstream()

    return ok({ ownership })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (message === 'ALREADY_OWNER') {
      return err('Employee is already an owner of this order')
    }

    console.error('Failed to add order owner:', error)
    return err('Failed to add order owner', 500)
  }
}))

// ─── PUT: Update ownership split percentages ────────────────────────────────

export const PUT = withVenue(withAuth({ allowCellular: true }, async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const { id: orderId } = await params
    const body = await request.json()
    const { locationId, splits } = body

    // ── Validate required fields ────────────────────────────────────────

    if (!locationId) {
      return err('locationId is required')
    }

    if (!orderId) {
      return err('orderId is required')
    }

    if (!splits || !Array.isArray(splits) || splits.length === 0) {
      return err('splits array is required and must not be empty')
    }

    // Validate each split entry has required fields
    for (const split of splits) {
      if (!split.employeeId) {
        return err('Each split must have an employeeId')
      }
      if (split.sharePercent === undefined || split.sharePercent === null || typeof split.sharePercent !== 'number') {
        return err('Each split must have a numeric sharePercent')
      }
    }

    // ── Auth check ──────────────────────────────────────────────────────
    // Requires TIPS_MANAGE_GROUPS permission
    const requestingEmployeeId = request.headers.get('x-employee-id')
    const auth = await requireAnyPermission(
      requestingEmployeeId,
      locationId,
      [PERMISSIONS.TIPS_MANAGE_GROUPS]
    )
    if (!auth.authorized) {
      return forbidden('Not authorized. Updating ownership splits requires tip management permission.')
    }

    // ── Update splits ───────────────────────────────────────────────────
    const ownership = await updateOwnershipSplits({
      orderId,
      splits,
    })

    // Emit order event for ownership splits update
    void emitOrderEvent(locationId, orderId, 'ORDER_METADATA_UPDATED', {
      ownershipAction: 'splits_updated',
      splitCount: splits.length,
    }).catch(err => console.error('[ownership] Failed to emit ORDER_METADATA_UPDATED event:', err))

    // Fire-and-forget socket dispatch for cross-terminal sync
    void dispatchOrderUpdated(locationId, {
      orderId,
      changes: ['ownership'],
    }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.ownership'))

    pushUpstream()

    return ok({ ownership })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (message.startsWith('INVALID_SPLIT_TOTAL')) {
      return err(message.replace('INVALID_SPLIT_TOTAL: ', ''))
    }

    if (message.startsWith('OWNER_NOT_FOUND')) {
      return err(message.replace('OWNER_NOT_FOUND: ', ''))
    }

    if (message.startsWith('NO_ACTIVE_OWNERSHIP')) {
      return err(message.replace('NO_ACTIVE_OWNERSHIP: ', ''))
    }

    console.error('Failed to update ownership splits:', error)
    return err('Failed to update ownership splits', 500)
  }
}))

// ─── DELETE: Remove an owner from an order ──────────────────────────────────

export const DELETE = withVenue(withAuth({ allowCellular: true }, async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { id: orderId } = await params
    const body = await request.json()
    const { employeeId } = body

    // ── Validate required fields ────────────────────────────────────────

    if (!orderId) {
      return err('orderId is required')
    }

    if (!employeeId) {
      return err('employeeId is required')
    }

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    const deleteLocationId = getRequestLocationId()
    let orderForDelete: { locationId: string } | null = deleteLocationId ? { locationId: deleteLocationId } : null
    if (!deleteLocationId) {
      const { db: database } = await import('@/lib/db')
      orderForDelete = await database.order.findUnique({
        where: { id: orderId },
        select: { locationId: true },
      })
    }

    // ── Auth check ──────────────────────────────────────────────────────
    // Self-removal: the requesting employee is removing themselves
    // Manager: requires TIPS_MANAGE_GROUPS permission
    const requestingEmployeeId = request.headers.get('x-employee-id')
    const isSelfRemoval = requestingEmployeeId === employeeId

    if (!isSelfRemoval) {
      if (!orderForDelete) {
        return notFound('Order not found')
      }

      const auth = await requireAnyPermission(
        requestingEmployeeId,
        orderForDelete.locationId,
        [PERMISSIONS.TIPS_MANAGE_GROUPS]
      )
      if (!auth.authorized) {
        return forbidden('Not authorized. Only self-removal or a manager with tip management permission can remove owners.')
      }
    } else if (!requestingEmployeeId) {
      return unauthorized('Employee ID is required')
    }

    // ── Remove owner ────────────────────────────────────────────────────
    const result = await removeOrderOwner({
      orderId,
      employeeId,
    })

    // null means ownership was deactivated (no owners remaining)
    const deactivated = result === null

    // Emit order event for ownership removal
    if (orderForDelete?.locationId) {
      void emitOrderEvent(orderForDelete.locationId, orderId, 'ORDER_METADATA_UPDATED', {
        employeeId,
        ownershipAction: deactivated ? 'ownership_deactivated' : 'owner_removed',
      }).catch(err => console.error('[ownership] Failed to emit ORDER_METADATA_UPDATED event:', err))
    }

    pushUpstream()

    return ok({
      success: true,
      deactivated,
      ownership: result,
    })
  } catch (error) {
    console.error('Failed to remove order owner:', error)
    return err('Failed to remove order owner', 500)
  }
}))
