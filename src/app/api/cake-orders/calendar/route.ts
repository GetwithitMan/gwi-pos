import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { requireCakeFeature } from '@/lib/cake-orders/require-cake-feature'

// ── Color maps ──────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  deposit_paid: '#eab308',   // yellow
  in_production: '#22c55e',  // green
  ready: '#14b8a6',          // teal
  delivered: '#3b82f6',      // blue
}

const BLOCK_TYPE_COLORS: Record<string, string> = {
  production: '#f97316',     // orange
  decoration: '#a855f7',     // purple
  delivery: '#06b6d4',       // cyan
  blocked: '#ef4444',        // red
}

// GET /api/cake-orders/calendar — combined calendar events (orders + manual blocks)
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const status = searchParams.get('status')
    const assignedTo = searchParams.get('assignedTo')

    if (!locationId || !startDate || !endDate) {
      return NextResponse.json(
        { error: 'locationId, startDate, and endDate are required' },
        { status: 400 },
      )
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

    // ── Query 1: CakeOrders as calendar events ────────────────────────
    const orderConditions: string[] = [
      'co."locationId" = $1',
      'co."deletedAt" IS NULL',
      'co."eventDate" >= $2::date',
      'co."eventDate" <= $3::date',
    ]
    const orderParams: unknown[] = [locationId, startDate, endDate]
    let paramIdx = 4

    // Default status filter for calendar-relevant statuses
    if (status) {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean)
      if (statuses.length === 1) {
        orderConditions.push(`co."status" = $${paramIdx}`)
        orderParams.push(statuses[0])
        paramIdx++
      } else if (statuses.length > 1) {
        const placeholders = statuses.map((_, i) => `$${paramIdx + i}`).join(', ')
        orderConditions.push(`co."status" IN (${placeholders})`)
        for (const s of statuses) {
          orderParams.push(s)
          paramIdx++
        }
      }
    } else {
      // Default: only show active calendar-relevant statuses
      orderConditions.push(`co."status" IN ('deposit_paid', 'in_production', 'ready', 'delivered')`)
    }

    if (assignedTo) {
      orderConditions.push(`co."assignedTo" = $${paramIdx}`)
      orderParams.push(assignedTo)
      paramIdx++
    }

    const orderWhereClause = orderConditions.join(' AND ')

    const orders = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT
         co."id",
         co."orderNumber",
         co."status",
         co."eventDate",
         co."eventTimeStart",
         co."eventTimeEnd",
         co."assignedTo",
         c."firstName" AS "customerFirstName",
         c."lastName" AS "customerLastName"
       FROM "CakeOrder" co
       LEFT JOIN "Customer" c ON c."id" = co."customerId"
       WHERE ${orderWhereClause}
       ORDER BY co."eventDate" ASC`,
      ...orderParams,
    )

    const orderEvents = orders.map(o => {
      const orderNumber = o.orderNumber ?? '?'
      const customerName = [o.customerFirstName, o.customerLastName].filter(Boolean).join(' ')
      const statusStr = o.status as string
      return {
        id: o.id as string,
        type: 'order' as const,
        title: `CK-${orderNumber} ${customerName}`.trim(),
        start: o.eventDate,
        end: o.eventDate,
        color: STATUS_COLORS[statusStr] || '#6b7280',
        status: statusStr,
        assignedTo: o.assignedTo,
        orderNumber,
        eventTimeStart: o.eventTimeStart || null,
        eventTimeEnd: o.eventTimeEnd || null,
      }
    })

    // ── Query 2: CakeCalendarBlocks ───────────────────────────────────
    const blocks = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT
         b."id",
         b."title",
         b."startDate",
         b."endDate",
         b."blockType",
         b."cakeOrderId",
         b."employeeId",
         b."notes"
       FROM "CakeCalendarBlock" b
       WHERE b."locationId" = $1
         AND b."deletedAt" IS NULL
         AND b."startDate" <= $3::date
         AND b."endDate" >= $2::date
       ORDER BY b."startDate" ASC`,
      locationId,
      startDate,
      endDate,
    )

    const blockEvents = blocks.map(b => {
      const blockType = b.blockType as string
      return {
        id: b.id as string,
        type: 'block' as const,
        title: b.title as string,
        start: b.startDate,
        end: b.endDate,
        color: BLOCK_TYPE_COLORS[blockType] || '#6b7280',
        blockType,
        cakeOrderId: b.cakeOrderId || null,
        employeeId: b.employeeId || null,
        notes: b.notes || null,
      }
    })

    // ── Combine and sort by start date ────────────────────────────────
    const combined = [...orderEvents, ...blockEvents].sort((a, b) => {
      const aDate = String(a.start)
      const bDate = String(b.start)
      return aDate.localeCompare(bDate)
    })

    return NextResponse.json({ data: combined })
  } catch (error) {
    console.error('Failed to fetch cake calendar:', error)
    return NextResponse.json({ error: 'Failed to fetch cake calendar' }, { status: 500 })
  }
})

// POST /api/cake-orders/calendar — create a calendar block
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
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
    const gatePost = await requireCakeFeature(locationId)
    if (gatePost) return gatePost

    // ── Validate body ─────────────────────────────────────────────────
    const { title, startDate, endDate, blockType, cakeOrderId, notes } = body
    const assignedEmployeeId = body.employeeId || null

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 })
    }

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 })
    }

    if (new Date(endDate) < new Date(startDate)) {
      return NextResponse.json({ error: 'endDate must be >= startDate' }, { status: 400 })
    }

    const validBlockTypes = ['production', 'decoration', 'delivery', 'blocked']
    const resolvedBlockType = blockType || 'production'
    if (!validBlockTypes.includes(resolvedBlockType)) {
      return NextResponse.json(
        { error: `blockType must be one of: ${validBlockTypes.join(', ')}` },
        { status: 400 },
      )
    }

    // ── Validate cakeOrderId if provided ──────────────────────────────
    if (cakeOrderId) {
      const orderExists = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT "id" FROM "CakeOrder" WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
        cakeOrderId,
        locationId,
      )
      if (orderExists.length === 0) {
        return NextResponse.json({ error: 'Referenced cake order not found' }, { status: 404 })
      }
    }

    // ── Validate employeeId if provided ───────────────────────────────
    if (assignedEmployeeId) {
      const empExists = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT "id" FROM "Employee" WHERE "id" = $1 LIMIT 1`,
        assignedEmployeeId,
      )
      if (empExists.length === 0) {
        return NextResponse.json({ error: 'Referenced employee not found' }, { status: 404 })
      }
    }

    // ── INSERT CakeCalendarBlock ──────────────────────────────────────
    const blockId = crypto.randomUUID()

    await db.$executeRawUnsafe(
      `INSERT INTO "CakeCalendarBlock" (
        "id", "locationId", "cakeOrderId", "title", "startDate", "endDate",
        "blockType", "employeeId", "notes", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5::date, $6::date,
        $7, $8, $9, NOW(), NOW()
      )`,
      blockId,
      locationId,
      cakeOrderId || null,
      title.trim(),
      startDate,
      endDate,
      resolvedBlockType,
      assignedEmployeeId,
      notes || null,
    )

    pushUpstream()

    // ── Fetch and return created block ────────────────────────────────
    const created = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "CakeCalendarBlock" WHERE "id" = $1`,
      blockId,
    )

    return NextResponse.json({ data: created[0] })
  } catch (error) {
    console.error('Failed to create cake calendar block:', error)
    return NextResponse.json({ error: 'Failed to create cake calendar block' }, { status: 500 })
  }
})
