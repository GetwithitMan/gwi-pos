import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

// PATCH /api/cake-orders/calendar/[blockId] — update a calendar block
export const PATCH = withVenue(async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ blockId: string }> },
) {
  try {
    const { blockId } = await params
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

    // ── Verify block exists ───────────────────────────────────────────
    const existing = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "CakeCalendarBlock"
       WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
       LIMIT 1`,
      blockId,
      locationId,
    )

    if (existing.length === 0) {
      return NextResponse.json({ error: 'Calendar block not found' }, { status: 404 })
    }

    // ── Build dynamic SET clause ──────────────────────────────────────
    const setClauses: string[] = []
    const setParams: unknown[] = []
    let paramIdx = 3 // $1 = blockId, $2 = locationId

    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || body.title.trim().length === 0) {
        return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 })
      }
      setClauses.push(`"title" = $${paramIdx}`)
      setParams.push(body.title.trim())
      paramIdx++
    }

    if (body.startDate !== undefined) {
      setClauses.push(`"startDate" = $${paramIdx}::date`)
      setParams.push(body.startDate)
      paramIdx++
    }

    if (body.endDate !== undefined) {
      setClauses.push(`"endDate" = $${paramIdx}::date`)
      setParams.push(body.endDate)
      paramIdx++
    }

    if (body.blockType !== undefined) {
      const validBlockTypes = ['production', 'decoration', 'delivery', 'blocked']
      if (!validBlockTypes.includes(body.blockType)) {
        return NextResponse.json(
          { error: `blockType must be one of: ${validBlockTypes.join(', ')}` },
          { status: 400 },
        )
      }
      setClauses.push(`"blockType" = $${paramIdx}`)
      setParams.push(body.blockType)
      paramIdx++
    }

    if (body.cakeOrderId !== undefined) {
      if (body.cakeOrderId) {
        const orderExists = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT "id" FROM "CakeOrder" WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
          body.cakeOrderId,
          locationId,
        )
        if (orderExists.length === 0) {
          return NextResponse.json({ error: 'Referenced cake order not found' }, { status: 404 })
        }
      }
      setClauses.push(`"cakeOrderId" = $${paramIdx}`)
      setParams.push(body.cakeOrderId || null)
      paramIdx++
    }

    if (body.employeeId !== undefined) {
      if (body.employeeId) {
        const empExists = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT "id" FROM "Employee" WHERE "id" = $1 LIMIT 1`,
          body.employeeId,
        )
        if (empExists.length === 0) {
          return NextResponse.json({ error: 'Referenced employee not found' }, { status: 404 })
        }
      }
      setClauses.push(`"employeeId" = $${paramIdx}`)
      setParams.push(body.employeeId || null)
      paramIdx++
    }

    if (body.notes !== undefined) {
      setClauses.push(`"notes" = $${paramIdx}`)
      setParams.push(body.notes || null)
      paramIdx++
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    // Always update updatedAt
    setClauses.push(`"updatedAt" = NOW()`)

    // ── Validate date range if both dates are being set ───────────────
    const resolvedStartDate = body.startDate ?? existing[0].startDate
    const resolvedEndDate = body.endDate ?? existing[0].endDate
    if (new Date(resolvedEndDate as string) < new Date(resolvedStartDate as string)) {
      return NextResponse.json({ error: 'endDate must be >= startDate' }, { status: 400 })
    }

    // ── Execute UPDATE ────────────────────────────────────────────────
    await db.$executeRawUnsafe(
      `UPDATE "CakeCalendarBlock"
       SET ${setClauses.join(', ')}
       WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      blockId,
      locationId,
      ...setParams,
    )

    // ── Fetch and return updated block ────────────────────────────────
    const updated = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "CakeCalendarBlock" WHERE "id" = $1`,
      blockId,
    )

    return NextResponse.json({ data: updated[0] })
  } catch (error) {
    console.error('Failed to update cake calendar block:', error)
    return NextResponse.json({ error: 'Failed to update cake calendar block' }, { status: 500 })
  }
})

// DELETE /api/cake-orders/calendar/[blockId] — soft delete a calendar block
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ blockId: string }> },
) {
  try {
    const { blockId } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // ── Permission check ──────────────────────────────────────────────
    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || searchParams.get('employeeId')

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.CAKE_EDIT)
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    // ── Verify block exists ───────────────────────────────────────────
    const existing = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "id" FROM "CakeCalendarBlock"
       WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
       LIMIT 1`,
      blockId,
      locationId,
    )

    if (existing.length === 0) {
      return NextResponse.json({ error: 'Calendar block not found' }, { status: 404 })
    }

    // ── Soft delete ───────────────────────────────────────────────────
    await db.$executeRawUnsafe(
      `UPDATE "CakeCalendarBlock"
       SET "deletedAt" = NOW(), "updatedAt" = NOW()
       WHERE "id" = $1 AND "locationId" = $2`,
      blockId,
      locationId,
    )

    return NextResponse.json({ data: { id: blockId, deleted: true } })
  } catch (error) {
    console.error('Failed to delete cake calendar block:', error)
    return NextResponse.json({ error: 'Failed to delete cake calendar block' }, { status: 500 })
  }
})
