import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'

// GET - Campaign detail with recipient list and stats
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const campaigns = await db.$queryRawUnsafe(`
      SELECT * FROM "MarketingCampaign"
      WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      LIMIT 1
    `, id, locationId) as Record<string, unknown>[]

    if (campaigns.length === 0) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const campaign = campaigns[0]

    // Get recipient breakdown
    const recipientStats = await db.$queryRawUnsafe(`
      SELECT
        status,
        COUNT(*)::int as count
      FROM "MarketingRecipient"
      WHERE "campaignId" = $1
      GROUP BY status
      ORDER BY status
    `, id) as { status: string; count: number }[]

    // Get recent recipients (limit 100)
    const recipients = await db.$queryRawUnsafe(`
      SELECT
        r.id, r."customerId", r.channel, r.address, r.status,
        r."sentAt", r."deliveredAt", r."openedAt", r."errorMessage"
      FROM "MarketingRecipient" r
      WHERE r."campaignId" = $1
      ORDER BY r."createdAt" DESC
      LIMIT 100
    `, id) as Record<string, unknown>[]

    return NextResponse.json({
      data: {
        ...campaign,
        recipientStats,
        recipients,
      },
    })
  } catch (error) {
    console.error('[Marketing] Failed to get campaign:', error)
    return NextResponse.json({ error: 'Failed to get campaign' }, { status: 500 })
  }
})

// PUT - Update campaign (only if draft or scheduled)
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, employeeId, name, subject, bodyContent, segment, scheduledFor } = body

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? employeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.MGR_DISCOUNTS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Verify campaign exists and is editable
    const existing = await db.$queryRawUnsafe(`
      SELECT id, status FROM "MarketingCampaign"
      WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      LIMIT 1
    `, id, locationId) as { id: string; status: string }[]

    if (existing.length === 0) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    if (!['draft', 'scheduled'].includes(existing[0].status)) {
      return NextResponse.json(
        { error: `Cannot edit campaign in '${existing[0].status}' status` },
        { status: 400 }
      )
    }

    // Build SET clauses dynamically
    const setClauses: string[] = ['"updatedAt" = NOW()']
    const values: unknown[] = [id, locationId]
    let paramIdx = 3

    if (name !== undefined) {
      setClauses.push(`"name" = $${paramIdx}`)
      values.push(name)
      paramIdx++
    }
    if (subject !== undefined) {
      setClauses.push(`"subject" = $${paramIdx}`)
      values.push(subject)
      paramIdx++
    }
    if (bodyContent !== undefined) {
      setClauses.push(`"body" = $${paramIdx}`)
      values.push(bodyContent)
      paramIdx++
    }
    if (segment !== undefined) {
      setClauses.push(`"segment" = $${paramIdx}`)
      values.push(segment)
      paramIdx++
    }
    if (scheduledFor !== undefined) {
      setClauses.push(`"scheduledFor" = $${paramIdx}`)
      values.push(scheduledFor ? new Date(scheduledFor) : null)
      paramIdx++

      // Update status based on scheduledFor
      setClauses.push(`"status" = $${paramIdx}`)
      values.push(scheduledFor ? 'scheduled' : 'draft')
      paramIdx++
    }

    const result = await db.$queryRawUnsafe(`
      UPDATE "MarketingCampaign"
      SET ${setClauses.join(', ')}
      WHERE id = $1 AND "locationId" = $2
      RETURNING *
    `, ...values) as Record<string, unknown>[]

    return NextResponse.json({ data: result[0] })
  } catch (error) {
    console.error('[Marketing] Failed to update campaign:', error)
    return NextResponse.json({ error: 'Failed to update campaign' }, { status: 500 })
  }
})

// DELETE - Cancel / soft-delete a campaign
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? employeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.MGR_DISCOUNTS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Cancel: set status to cancelled and soft-delete
    await db.$executeRawUnsafe(`
      UPDATE "MarketingCampaign"
      SET status = 'cancelled', "deletedAt" = NOW(), "updatedAt" = NOW()
      WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
    `, id, locationId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Marketing] Failed to delete campaign:', error)
    return NextResponse.json({ error: 'Failed to delete campaign' }, { status: 500 })
  }
})
