import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { dispatchCakeOrderNew } from '@/lib/socket-dispatch'
import { adminCreateCakeOrderSchema } from '@/lib/cake-orders/schemas'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { requireCakeFeature } from '@/lib/cake-orders/require-cake-feature'
import { err, ok } from '@/lib/api-response'

// GET /api/cake-orders — list cake orders (cursor-based pagination)
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return err('locationId is required')
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

    // ── Parse filters ─────────────────────────────────────────────────
    const cursor = searchParams.get('cursor')
    const take = Math.min(parseInt(searchParams.get('take') || '50', 10), 100)
    const status = searchParams.get('status')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const customerId = searchParams.get('customerId')
    const assignedTo = searchParams.get('assignedTo')
    const search = searchParams.get('search')

    // ── Build raw SQL ─────────────────────────────────────────────────
    const conditions: string[] = ['co."locationId" = $1', 'co."deletedAt" IS NULL']
    const params: unknown[] = [locationId]
    let paramIdx = 2

    // Comma-separated status filter
    if (status) {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean)
      if (statuses.length === 1) {
        conditions.push(`co."status" = $${paramIdx}`)
        params.push(statuses[0])
        paramIdx++
      } else if (statuses.length > 1) {
        const placeholders = statuses.map((_, i) => `$${paramIdx + i}`).join(', ')
        conditions.push(`co."status" IN (${placeholders})`)
        for (const s of statuses) {
          params.push(s)
          paramIdx++
        }
      }
    }

    if (dateFrom) {
      conditions.push(`co."eventDate" >= $${paramIdx}::date`)
      params.push(dateFrom)
      paramIdx++
    }

    if (dateTo) {
      conditions.push(`co."eventDate" <= $${paramIdx}::date`)
      params.push(dateTo)
      paramIdx++
    }

    if (customerId) {
      conditions.push(`co."customerId" = $${paramIdx}`)
      params.push(customerId)
      paramIdx++
    }

    if (assignedTo) {
      conditions.push(`co."assignedTo" = $${paramIdx}`)
      params.push(assignedTo)
      paramIdx++
    }

    if (search) {
      conditions.push(
        `(c."firstName" ILIKE $${paramIdx} OR c."lastName" ILIKE $${paramIdx} OR c."phone" ILIKE $${paramIdx} OR co."orderNumber"::text ILIKE $${paramIdx})`,
      )
      params.push(`%${search}%`)
      paramIdx++
    }

    // Cursor-based pagination
    if (cursor) {
      conditions.push(`co."id" < $${paramIdx}`)
      params.push(cursor)
      paramIdx++
    }

    const whereClause = conditions.join(' AND ')

    // Fetch one extra to determine hasMore
    params.push(take + 1)
    const orders = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT
         co.*,
         c."firstName" AS "customerFirstName",
         c."lastName" AS "customerLastName",
         c."phone" AS "customerPhone",
         c."email" AS "customerEmail"
       FROM "CakeOrder" co
       LEFT JOIN "Customer" c ON c."id" = co."customerId"
       WHERE ${whereClause}
       ORDER BY co."createdAt" DESC, co."id" DESC
       LIMIT $${paramIdx}`,
      ...params,
    )

    const hasMore = orders.length > take
    const page = hasMore ? orders.slice(0, take) : orders
    const nextCursor = hasMore ? (page[page.length - 1]?.id as string) : null

    return ok({
        orders: page,
        pagination: { nextCursor, hasMore },
      })
  } catch (error) {
    console.error('Failed to list cake orders:', error)
    return err('Failed to list cake orders', 500)
  }
})

// POST /api/cake-orders — admin create a cake order
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // ── Resolve actor ─────────────────────────────────────────────────
    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || body.employeeId
    const locationId = actor.locationId || body.locationId

    if (!locationId) {
      return err('locationId is required')
    }

    // ── Permission check ──────────────────────────────────────────────
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.CAKE_CREATE)
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
    const parsed = adminCreateCakeOrderSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      )
    }
    const input = parsed.data

    // ── Generate ID ───────────────────────────────────────────────────
    const orderId = crypto.randomUUID()

    // ── Advisory lock on location for orderNumber sequence ────────────
    const orderNumberRows = await db.$queryRawUnsafe<[{ nextval: string | number }]>(
      `SELECT pg_advisory_xact_lock(hashtext($1::text));
       SELECT COALESCE(MAX("orderNumber"), 0) + 1 AS nextval
       FROM "CakeOrder"
       WHERE "locationId" = $1`,
      locationId,
    )
    const orderNumber = Number(orderNumberRows[0]?.nextval ?? 1)

    // ── Capacity check advisory lock on locationId:eventDate ──────────
    // This serializes order creation for the same date to prevent overselling
    await db.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))`,
      locationId,
      input.eventDate,
    )

    // ── Resolve or create customer ────────────────────────────────────
    let resolvedCustomerId = input.customerId || null

    if (!resolvedCustomerId && input.customerFirstName && input.customerPhone) {
      // Try to find existing customer by phone + location
      const existing = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT "id" FROM "Customer"
         WHERE "locationId" = $1 AND "phone" = $2 AND "deletedAt" IS NULL
         LIMIT 1`,
        locationId,
        input.customerPhone,
      )

      if (existing.length > 0) {
        resolvedCustomerId = existing[0].id as string
      } else {
        // Create new customer
        resolvedCustomerId = crypto.randomUUID()
        await db.$executeRawUnsafe(
          `INSERT INTO "Customer" (
            "id", "locationId", "firstName", "lastName", "phone", "email",
            "createdAt", "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
          resolvedCustomerId,
          locationId,
          input.customerFirstName,
          input.customerLastName || null,
          input.customerPhone,
          input.customerEmail || null,
        )
      }
    }

    // ── Determine initial status ──────────────────────────────────────
    const initialStatus = input.status || 'submitted'

    // ── INSERT CakeOrder ──────────────────────────────────────────────
    await db.$executeRawUnsafe(
      `INSERT INTO "CakeOrder" (
        "id", "locationId", "orderNumber", "customerId",
        "eventDate", "eventTimeStart", "eventTimeEnd", "eventType", "guestCount",
        "deliveryType", "deliveryAddress",
        "cakeConfig", "designConfig", "dietaryConfig",
        "notes", "internalNotes",
        "status", "source", "assignedTo",
        "createdBy", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4,
        $5::date, $6, $7, $8, $9,
        $10, $11,
        $12::jsonb, $13::jsonb, $14::jsonb,
        $15, $16,
        $17, $18, $19,
        $20, NOW(), NOW()
      )`,
      orderId,
      locationId,
      orderNumber,
      resolvedCustomerId,
      input.eventDate,
      input.eventTimeStart || null,
      input.eventTimeEnd || null,
      input.eventType,
      input.guestCount ?? null,
      input.deliveryType,
      input.deliveryAddress || null,
      JSON.stringify(input.cakeConfig),
      JSON.stringify(input.designConfig),
      JSON.stringify(input.dietaryConfig),
      input.notes || null,
      input.internalNotes || null,
      initialStatus,
      input.source || 'admin',
      null,
      auth.employee.id,
    )

    // ── INSERT CakeOrderChange (audit trail) ──────────────────────────
    const changeId = crypto.randomUUID()
    await db.$executeRawUnsafe(
      `INSERT INTO "CakeOrderChange" (
        "id", "cakeOrderId", "changeType", "changedBy", "source",
        "details", "createdAt"
      ) VALUES (
        $1, $2, 'status_change', $3, 'admin',
        $4::jsonb, NOW()
      )`,
      changeId,
      orderId,
      auth.employee.id,
      JSON.stringify({
        previousStatus: null,
        newStatus: initialStatus,
        trigger: 'admin_create',
      }),
    )

    pushUpstream()

    // ── Socket event ──────────────────────────────────────────────────
    void dispatchCakeOrderNew(locationId, {
      cakeOrderId: orderId,
      customerName: input.customerFirstName ? `${input.customerFirstName} ${input.customerLastName || ''}`.trim() : '',
      eventDate: input.eventDate,
      source: input.source || 'admin',
    }).catch(err => console.error('[cake-orders] Socket dispatch failed:', err))

    // ── Fetch the created order for response ──────────────────────────
    const created = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT co.*,
              c."firstName" AS "customerFirstName",
              c."lastName" AS "customerLastName",
              c."phone" AS "customerPhone",
              c."email" AS "customerEmail"
       FROM "CakeOrder" co
       LEFT JOIN "Customer" c ON c."id" = co."customerId"
       WHERE co."id" = $1`,
      orderId,
    )

    return ok(created[0])
  } catch (error) {
    console.error('Failed to create cake order:', error)
    return err('Failed to create cake order', 500)
  }
})
