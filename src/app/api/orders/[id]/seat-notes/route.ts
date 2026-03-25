import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { emitToLocation } from '@/lib/socket-server'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { emitOrderEvent } from '@/lib/order-events/emitter'

interface SeatAllergies {
  [seat: string]: string
}

interface OrderNotesJson {
  seatAllergies?: SeatAllergies
  text?: string
}

/**
 * Parse Order.notes field — handles both legacy plain-text and new JSON format.
 */
function parseOrderNotes(raw: string | null): OrderNotesJson {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as OrderNotesJson
    }
    // Parsed but not an object — treat as legacy text
    return { text: raw }
  } catch {
    // Not JSON — legacy plain-text
    return { text: raw }
  }
}

/**
 * Serialize OrderNotesJson back to string. Returns null if empty.
 */
function serializeOrderNotes(data: OrderNotesJson): string | null {
  const hasText = !!data.text
  const hasAllergies = data.seatAllergies && Object.keys(data.seatAllergies).length > 0
  if (!hasText && !hasAllergies) return null
  return JSON.stringify(data)
}

// PUT /api/orders/[id]/seat-notes — Set/update seat allergy notes
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json()
    const { seatNumber, allergyNotes } = body as { seatNumber: number; allergyNotes: string }

    if (typeof seatNumber !== 'number' || seatNumber < 1) {
      return NextResponse.json(
        { error: 'seatNumber must be a positive integer' },
        { status: 400 }
      )
    }
    if (typeof allergyNotes !== 'string') {
      return NextResponse.json(
        { error: 'allergyNotes must be a string' },
        { status: 400 }
      )
    }
    if (allergyNotes.length > 2000) {
      return NextResponse.json(
        { error: 'Allergy notes exceeds maximum length of 2000 characters' },
        { status: 400 }
      )
    }

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { id: true, locationId: true, notes: true },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const empId = actor.employeeId || body.employeeId
    const auth = await requirePermission(empId, order.locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    // Parse current notes and merge seat allergy
    const parsed = parseOrderNotes(order.notes)
    if (!parsed.seatAllergies) {
      parsed.seatAllergies = {}
    }

    const trimmed = allergyNotes.trim()
    if (trimmed) {
      parsed.seatAllergies[String(seatNumber)] = trimmed
    } else {
      // Empty notes = remove this seat's entry
      delete parsed.seatAllergies[String(seatNumber)]
    }

    const newNotes = serializeOrderNotes(parsed)

    const updated = await db.order.update({
      where: { id: orderId },
      data: {
        notes: newNotes,
        lastMutatedBy: 'local',
      },
      select: {
        id: true,
        notes: true,
      },
    })

    // Emit order event for event-sourced sync
    void emitOrderEvent(order.locationId, orderId, 'ORDER_METADATA_UPDATED', {
      notes: newNotes,
    })

    // Socket events for cross-terminal awareness
    void emitToLocation(order.locationId, 'orders:list-changed', { orderId }).catch(console.error)
    void emitToLocation(order.locationId, 'order:updated', { orderId, changes: ['notes'] }).catch(console.error)

    // Sync
    pushUpstream()
    void notifyDataChanged({ locationId: order.locationId, domain: 'orders', action: 'updated', entityId: orderId })

    return NextResponse.json({
      data: {
        orderId: updated.id,
        notes: updated.notes,
        seatAllergies: parsed.seatAllergies,
      },
    })
  } catch (error) {
    console.error('Failed to update seat allergy notes:', error)
    return NextResponse.json(
      { error: 'Failed to update seat allergy notes' },
      { status: 500 }
    )
  }
})

// GET /api/orders/[id]/seat-notes — Get seat allergy notes
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { id: true, notes: true },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const parsed = parseOrderNotes(order.notes)

    return NextResponse.json({
      data: {
        orderId: order.id,
        seatAllergies: parsed.seatAllergies || {},
      },
    })
  } catch (error) {
    console.error('Failed to get seat allergy notes:', error)
    return NextResponse.json(
      { error: 'Failed to get seat allergy notes' },
      { status: 500 }
    )
  }
})
