import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { requireCakeFeature } from '@/lib/cake-orders/require-cake-feature'
import { err, notFound, ok } from '@/lib/api-response'

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
      return err('locationId, startDate, and endDate are required')
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

    const orders = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT
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
       ORDER BY co."eventDate" ASC`

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
    const blocks = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT
         b."id",
         b."title",
         b."startDate",
         b."endDate",
         b."blockType",
         b."cakeOrderId",
         b."employeeId",
         b."notes"
       FROM "CakeCalendarBlock" b
       WHERE b."locationId" = ${locationId}
         AND b."deletedAt" IS NULL
         AND b."startDate" <= ${endDate}::date
         AND b."endDate" >= ${startDate}::date
       ORDER BY b."startDate" ASC`

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

    return ok(combined)
  } catch (error) {
    console.error('Failed to fetch cake calendar:', error)
    return err('Failed to fetch cake calendar', 500)
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
      return err('locationId is required')
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
      return err('title is required')
    }

    if (!startDate || !endDate) {
      return err('startDate and endDate are required')
    }

    if (new Date(endDate) < new Date(startDate)) {
      return err('endDate must be >= startDate')
    }

    const validBlockTypes = ['production', 'decoration', 'delivery', 'blocked']
    const resolvedBlockType = blockType || 'production'
    if (!validBlockTypes.includes(resolvedBlockType)) {
      return err(`blockType must be one of: ${validBlockTypes.join(', ')}`)
    }

    // ── Validate cakeOrderId if provided ──────────────────────────────
    if (cakeOrderId) {
      const orderExists = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT "id" FROM "CakeOrder" WHERE "id" = ${cakeOrderId} AND "locationId" = ${locationId} AND "deletedAt" IS NULL LIMIT 1`
      if (orderExists.length === 0) {
        return notFound('Referenced cake order not found')
      }
    }

    // ── Validate employeeId if provided ───────────────────────────────
    if (assignedEmployeeId) {
      const empExists = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT "id" FROM "Employee" WHERE "id" = ${assignedEmployeeId} LIMIT 1`
      if (empExists.length === 0) {
        return notFound('Referenced employee not found')
      }
    }

    // ── INSERT CakeCalendarBlock ──────────────────────────────────────
    const blockId = crypto.randomUUID()

    await db.$executeRaw`INSERT INTO "CakeCalendarBlock" (
        "id", "locationId", "cakeOrderId", "title", "startDate", "endDate",
        "blockType", "employeeId", "notes", "createdAt", "updatedAt"
      ) VALUES (
        ${blockId}, ${locationId}, ${cakeOrderId || null}, ${title.trim()}, ${startDate}::date, ${endDate}::date,
        ${resolvedBlockType}, ${assignedEmployeeId}, ${notes || null}, NOW(), NOW()
      )`

    pushUpstream()

    // ── Fetch and return created block ────────────────────────────────
    const created = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "CakeCalendarBlock" WHERE "id" = ${blockId}`

    return ok(created[0])
  } catch (error) {
    console.error('Failed to create cake calendar block:', error)
    return err('Failed to create cake calendar block', 500)
  }
})
