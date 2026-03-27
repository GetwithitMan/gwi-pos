import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { dispatchCakeOrderUpdated } from '@/lib/socket-dispatch'
import { updateCakeOrderSchema } from '@/lib/cake-orders/schemas'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { requireCakeFeature } from '@/lib/cake-orders/require-cake-feature'

// GET /api/cake-orders/[id] — get full cake order detail
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // ── Permission check ──────────────────────────────────────────────
    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || searchParams.get('employeeId')

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.CAKE_VIEW)
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    // ── Feature gate ────────────────────────────────────────────────────
    const gate = await requireCakeFeature(locationId)
    if (gate) return gate

    // ── Fetch CakeOrder + Customer ────────────────────────────────────
    const orders = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT co.*,
              c."firstName" AS "customerFirstName",
              c."lastName" AS "customerLastName",
              c."phone" AS "customerPhone",
              c."email" AS "customerEmail"
       FROM "CakeOrder" co
       LEFT JOIN "Customer" c ON c."id" = co."customerId"
       WHERE co."id" = $1 AND co."locationId" = $2 AND co."deletedAt" IS NULL
       LIMIT 1`,
      id,
      locationId,
    )

    if (orders.length === 0) {
      return NextResponse.json({ error: 'Cake order not found' }, { status: 404 })
    }

    const order = orders[0]

    // ── Fetch latest CakeQuote ────────────────────────────────────────
    const quotes = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "CakeQuote"
       WHERE "cakeOrderId" = $1
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      id,
    )
    const latestQuote = quotes.length > 0 ? quotes[0] : null

    // ── Fetch CakePayments ────────────────────────────────────────────
    const payments = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "CakePayment"
       WHERE "cakeOrderId" = $1
       ORDER BY "createdAt" ASC`,
      id,
    )

    // ── Fetch recent CakeOrderChanges ─────────────────────────────────
    const changes = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "CakeOrderChange"
       WHERE "cakeOrderId" = $1
       ORDER BY "createdAt" DESC
       LIMIT 50`,
      id,
    )

    return NextResponse.json({
      data: {
        ...order,
        latestQuote,
        payments,
        changes,
      },
    })
  } catch (error) {
    console.error('Failed to fetch cake order:', error)
    return NextResponse.json({ error: 'Failed to fetch cake order' }, { status: 500 })
  }
})

// PATCH /api/cake-orders/[id] — update a cake order
export const PATCH = withVenue(async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json()

    // ── Resolve actor ─────────────────────────────────────────────────
    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || body.employeeId
    const locationId = actor.locationId || body.locationId

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // ── Permission check ──────────────────────────────────────────────
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.CAKE_EDIT)
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    // ── Feature gate ────────────────────────────────────────────────────
    const gate = await requireCakeFeature(locationId)
    if (gate) return gate

    // ── Validate body ─────────────────────────────────────────────────
    const parsed = updateCakeOrderSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      )
    }
    const input = parsed.data

    // ── Fetch current order ───────────────────────────────────────────
    const orders = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "CakeOrder"
       WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
       LIMIT 1`,
      id,
      locationId,
    )

    if (orders.length === 0) {
      return NextResponse.json({ error: 'Cake order not found' }, { status: 404 })
    }

    const currentOrder = orders[0]

    // ── Optimistic concurrency check ──────────────────────────────────
    const currentUpdatedAt = currentOrder.updatedAt instanceof Date
      ? (currentOrder.updatedAt as Date).toISOString()
      : String(currentOrder.updatedAt)

    if (input.expectedUpdatedAt !== currentUpdatedAt) {
      return NextResponse.json(
        {
          code: 'CONFLICT',
          message: 'This order has been modified since you last loaded it. Please refresh and try again.',
          serverUpdatedAt: currentUpdatedAt,
        },
        { status: 409 },
      )
    }

    // ── Build update SET clauses ──────────────────────────────────────
    const setClauses: string[] = ['"updatedAt" = NOW()']
    const updateParams: unknown[] = []
    let paramIdx = 1

    // Track what changed for the audit trail
    const changedFields: Record<string, { from: unknown; to: unknown }> = {}

    if (input.eventDate !== undefined) {
      setClauses.push(`"eventDate" = $${paramIdx}::date`)
      updateParams.push(input.eventDate)
      changedFields.eventDate = { from: currentOrder.eventDate, to: input.eventDate }
      paramIdx++
    }

    if (input.eventTimeStart !== undefined) {
      setClauses.push(`"eventTimeStart" = $${paramIdx}`)
      updateParams.push(input.eventTimeStart)
      changedFields.eventTimeStart = { from: currentOrder.eventTimeStart, to: input.eventTimeStart }
      paramIdx++
    }

    if (input.eventTimeEnd !== undefined) {
      setClauses.push(`"eventTimeEnd" = $${paramIdx}`)
      updateParams.push(input.eventTimeEnd)
      changedFields.eventTimeEnd = { from: currentOrder.eventTimeEnd, to: input.eventTimeEnd }
      paramIdx++
    }

    if (input.eventType !== undefined) {
      setClauses.push(`"eventType" = $${paramIdx}`)
      updateParams.push(input.eventType)
      changedFields.eventType = { from: currentOrder.eventType, to: input.eventType }
      paramIdx++
    }

    if (input.guestCount !== undefined) {
      setClauses.push(`"guestCount" = $${paramIdx}`)
      updateParams.push(input.guestCount)
      changedFields.guestCount = { from: currentOrder.guestCount, to: input.guestCount }
      paramIdx++
    }

    if (input.deliveryType !== undefined) {
      setClauses.push(`"deliveryType" = $${paramIdx}`)
      updateParams.push(input.deliveryType)
      changedFields.deliveryType = { from: currentOrder.deliveryType, to: input.deliveryType }
      paramIdx++
    }

    if (input.deliveryAddress !== undefined) {
      setClauses.push(`"deliveryAddress" = $${paramIdx}`)
      updateParams.push(input.deliveryAddress)
      changedFields.deliveryAddress = { from: currentOrder.deliveryAddress, to: input.deliveryAddress }
      paramIdx++
    }

    if (input.cakeConfig !== undefined) {
      setClauses.push(`"cakeConfig" = $${paramIdx}::jsonb`)
      updateParams.push(JSON.stringify(input.cakeConfig))
      changedFields.cakeConfig = { from: '[previous]', to: '[updated]' }
      paramIdx++
    }

    if (input.designConfig !== undefined) {
      setClauses.push(`"designConfig" = $${paramIdx}::jsonb`)
      updateParams.push(JSON.stringify(input.designConfig))
      changedFields.designConfig = { from: '[previous]', to: '[updated]' }
      paramIdx++
    }

    if (input.dietaryConfig !== undefined) {
      setClauses.push(`"dietaryConfig" = $${paramIdx}::jsonb`)
      updateParams.push(JSON.stringify(input.dietaryConfig))
      changedFields.dietaryConfig = { from: '[previous]', to: '[updated]' }
      paramIdx++
    }

    if (input.notes !== undefined) {
      setClauses.push(`"notes" = $${paramIdx}`)
      updateParams.push(input.notes)
      changedFields.notes = { from: currentOrder.notes, to: input.notes }
      paramIdx++
    }

    if (input.internalNotes !== undefined) {
      setClauses.push(`"internalNotes" = $${paramIdx}`)
      updateParams.push(input.internalNotes)
      changedFields.internalNotes = { from: currentOrder.internalNotes, to: input.internalNotes }
      paramIdx++
    }

    if (input.assignedTo !== undefined) {
      setClauses.push(`"assignedTo" = $${paramIdx}`)
      updateParams.push(input.assignedTo)
      changedFields.assignedTo = { from: currentOrder.assignedTo, to: input.assignedTo }
      paramIdx++
    }

    if (input.customerId !== undefined) {
      setClauses.push(`"customerId" = $${paramIdx}`)
      updateParams.push(input.customerId)
      changedFields.customerId = { from: currentOrder.customerId, to: input.customerId }
      paramIdx++
    }

    // Only update if there are actual changes (besides updatedAt)
    if (Object.keys(changedFields).length === 0) {
      return NextResponse.json(
        { code: 'NO_CHANGES', message: 'No fields to update' },
        { status: 400 },
      )
    }

    // ── Execute UPDATE ────────────────────────────────────────────────
    updateParams.push(id)
    await db.$executeRawUnsafe(
      `UPDATE "CakeOrder" SET ${setClauses.join(', ')} WHERE "id" = $${paramIdx}`,
      ...updateParams,
    )

    // ── Determine change type for audit ───────────────────────────────
    let changeType = 'config_edited'
    if (changedFields.assignedTo) {
      changeType = 'assignment_changed'
    } else if (changedFields.notes || changedFields.internalNotes) {
      changeType = Object.keys(changedFields).length === 1 ? 'note_added' : 'config_edited'
    }

    // ── INSERT CakeOrderChange (audit trail) ──────────────────────────
    const changeId = crypto.randomUUID()
    await db.$executeRawUnsafe(
      `INSERT INTO "CakeOrderChange" (
        "id", "cakeOrderId", "changeType", "changedBy", "source",
        "details", "createdAt"
      ) VALUES (
        $1, $2, $3, $4, 'admin',
        $5::jsonb, NOW()
      )`,
      changeId,
      id,
      changeType,
      auth.employee.id,
      JSON.stringify({ changedFields }),
    )

    pushUpstream()

    // ── Socket event ──────────────────────────────────────────────────
    void dispatchCakeOrderUpdated(locationId, {
      cakeOrderId: id,
      status: currentOrder.status as string,
      changeType,
    }).catch(err => console.error('[cake-orders] Socket dispatch failed:', err))

    // ── Fetch updated order for response ──────────────────────────────
    const updated = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT co.*,
              c."firstName" AS "customerFirstName",
              c."lastName" AS "customerLastName",
              c."phone" AS "customerPhone",
              c."email" AS "customerEmail"
       FROM "CakeOrder" co
       LEFT JOIN "Customer" c ON c."id" = co."customerId"
       WHERE co."id" = $1
       LIMIT 1`,
      id,
    )

    return NextResponse.json({ data: updated[0] })
  } catch (error) {
    console.error('Failed to update cake order:', error)
    return NextResponse.json({ error: 'Failed to update cake order' }, { status: 500 })
  }
})
