/**
 * Order Ownership API (Skill 253)
 *
 * GET    - Get active ownership for an order
 * POST   - Add an owner to an order
 * PUT    - Update ownership split percentages
 * DELETE - Remove an owner from an order
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import {
  getActiveOwnership,
  addOrderOwner,
  removeOrderOwner,
  updateOwnershipSplits,
} from '@/lib/domain/tips/table-ownership'
import { withVenue } from '@/lib/with-venue'
import { dispatchOrderUpdated } from '@/lib/socket-dispatch'

type RouteContext = { params: Promise<{ id: string }> }

// ─── GET: Get active ownership for an order ─────────────────────────────────

export const GET = withVenue(async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id: orderId } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    if (!orderId) {
      return NextResponse.json(
        { error: 'orderId is required' },
        { status: 400 }
      )
    }

    // Auth: any authenticated employee can view ownership
    const requestingEmployeeId = request.headers.get('x-employee-id')
    if (!requestingEmployeeId) {
      return NextResponse.json(
        { error: 'Employee ID is required' },
        { status: 401 }
      )
    }

    const ownership = await getActiveOwnership(orderId)

    return NextResponse.json({ data: { ownership } })
  } catch (error) {
    console.error('Failed to get order ownership:', error)
    return NextResponse.json(
      { error: 'Failed to get order ownership' },
      { status: 500 }
    )
  }
})

// ─── POST: Add an owner to an order ─────────────────────────────────────────

export const POST = withVenue(async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { id: orderId } = await params
    const body = await request.json()
    const { locationId, employeeId, splitType, customPercent } = body

    // ── Validate required fields ────────────────────────────────────────

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    if (!orderId) {
      return NextResponse.json(
        { error: 'orderId is required' },
        { status: 400 }
      )
    }

    if (!employeeId) {
      return NextResponse.json(
        { error: 'employeeId is required' },
        { status: 400 }
      )
    }

    if (!splitType || (splitType !== 'even' && splitType !== 'custom')) {
      return NextResponse.json(
        { error: 'splitType must be "even" or "custom"' },
        { status: 400 }
      )
    }

    if (splitType === 'custom' && (customPercent === undefined || customPercent === null)) {
      return NextResponse.json(
        { error: 'customPercent is required when splitType is "custom"' },
        { status: 400 }
      )
    }

    // ── Auth check ──────────────────────────────────────────────────────
    // Allowed: self-add, order owner adding co-owners, or manager with tip permission
    const requestingEmployeeId = request.headers.get('x-employee-id')
    if (!requestingEmployeeId) {
      return NextResponse.json(
        { error: 'Employee ID is required' },
        { status: 401 }
      )
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
          return NextResponse.json(
            { error: 'Not authorized. Only the table owner or a manager can add co-owners.' },
            { status: 403 }
          )
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

    return NextResponse.json({ data: { ownership } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (message === 'ALREADY_OWNER') {
      return NextResponse.json(
        { error: 'Employee is already an owner of this order' },
        { status: 400 }
      )
    }

    console.error('Failed to add order owner:', error)
    return NextResponse.json(
      { error: 'Failed to add order owner' },
      { status: 500 }
    )
  }
})

// ─── PUT: Update ownership split percentages ────────────────────────────────

export const PUT = withVenue(async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const { id: orderId } = await params
    const body = await request.json()
    const { locationId, splits } = body

    // ── Validate required fields ────────────────────────────────────────

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    if (!orderId) {
      return NextResponse.json(
        { error: 'orderId is required' },
        { status: 400 }
      )
    }

    if (!splits || !Array.isArray(splits) || splits.length === 0) {
      return NextResponse.json(
        { error: 'splits array is required and must not be empty' },
        { status: 400 }
      )
    }

    // Validate each split entry has required fields
    for (const split of splits) {
      if (!split.employeeId) {
        return NextResponse.json(
          { error: 'Each split must have an employeeId' },
          { status: 400 }
        )
      }
      if (split.sharePercent === undefined || split.sharePercent === null || typeof split.sharePercent !== 'number') {
        return NextResponse.json(
          { error: 'Each split must have a numeric sharePercent' },
          { status: 400 }
        )
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
      return NextResponse.json(
        { error: 'Not authorized. Updating ownership splits requires tip management permission.' },
        { status: 403 }
      )
    }

    // ── Update splits ───────────────────────────────────────────────────
    const ownership = await updateOwnershipSplits({
      orderId,
      splits,
    })

    // Fire-and-forget socket dispatch for cross-terminal sync
    void dispatchOrderUpdated(locationId, {
      orderId,
      changes: ['ownership'],
    }).catch(() => {})

    return NextResponse.json({ data: { ownership } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (message.startsWith('INVALID_SPLIT_TOTAL')) {
      return NextResponse.json(
        { error: message.replace('INVALID_SPLIT_TOTAL: ', '') },
        { status: 400 }
      )
    }

    if (message.startsWith('OWNER_NOT_FOUND')) {
      return NextResponse.json(
        { error: message.replace('OWNER_NOT_FOUND: ', '') },
        { status: 400 }
      )
    }

    if (message.startsWith('NO_ACTIVE_OWNERSHIP')) {
      return NextResponse.json(
        { error: message.replace('NO_ACTIVE_OWNERSHIP: ', '') },
        { status: 400 }
      )
    }

    console.error('Failed to update ownership splits:', error)
    return NextResponse.json(
      { error: 'Failed to update ownership splits' },
      { status: 500 }
    )
  }
})

// ─── DELETE: Remove an owner from an order ──────────────────────────────────

export const DELETE = withVenue(async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { id: orderId } = await params
    const body = await request.json()
    const { employeeId } = body

    // ── Validate required fields ────────────────────────────────────────

    if (!orderId) {
      return NextResponse.json(
        { error: 'orderId is required' },
        { status: 400 }
      )
    }

    if (!employeeId) {
      return NextResponse.json(
        { error: 'employeeId is required' },
        { status: 400 }
      )
    }

    // ── Auth check ──────────────────────────────────────────────────────
    // Self-removal: the requesting employee is removing themselves
    // Manager: requires TIPS_MANAGE_GROUPS permission
    const requestingEmployeeId = request.headers.get('x-employee-id')
    const isSelfRemoval = requestingEmployeeId === employeeId

    if (!isSelfRemoval) {
      // Need locationId for permission check — get it from the ownership record
      // We look up the order to find locationId
      const { db } = await import('@/lib/db')
      const order = await db.order.findUnique({
        where: { id: orderId },
        select: { locationId: true },
      })

      if (!order) {
        return NextResponse.json(
          { error: 'Order not found' },
          { status: 404 }
        )
      }

      const auth = await requireAnyPermission(
        requestingEmployeeId,
        order.locationId,
        [PERMISSIONS.TIPS_MANAGE_GROUPS]
      )
      if (!auth.authorized) {
        return NextResponse.json(
          { error: 'Not authorized. Only self-removal or a manager with tip management permission can remove owners.' },
          { status: 403 }
        )
      }
    } else if (!requestingEmployeeId) {
      return NextResponse.json(
        { error: 'Employee ID is required' },
        { status: 401 }
      )
    }

    // ── Remove owner ────────────────────────────────────────────────────
    const result = await removeOrderOwner({
      orderId,
      employeeId,
    })

    // null means ownership was deactivated (no owners remaining)
    const deactivated = result === null

    return NextResponse.json({ data: {
      success: true,
      deactivated,
      ownership: result,
    } })
  } catch (error) {
    console.error('Failed to remove order owner:', error)
    return NextResponse.json(
      { error: 'Failed to remove order owner' },
      { status: 500 }
    )
  }
})
