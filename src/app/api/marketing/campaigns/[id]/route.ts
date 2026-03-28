import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { err, notFound, ok } from '@/lib/api-response'

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
      return err('Location ID is required')
    }

    const campaigns = await db.$queryRawUnsafe(`
      SELECT * FROM "MarketingCampaign"
      WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      LIMIT 1
    `, id, locationId) as Record<string, unknown>[]

    if (campaigns.length === 0) {
      return notFound('Campaign not found')
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

    return ok({
        ...campaign,
        recipientStats,
        recipients,
      })
  } catch (error) {
    console.error('[Marketing] Failed to get campaign:', error)
    return err('Failed to get campaign', 500)
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
      return err('Location ID is required')
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? employeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.MGR_DISCOUNTS)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Verify campaign exists and is editable
    const existing = await db.$queryRawUnsafe(`
      SELECT id, status FROM "MarketingCampaign"
      WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      LIMIT 1
    `, id, locationId) as { id: string; status: string }[]

    if (existing.length === 0) {
      return notFound('Campaign not found')
    }

    if (!['draft', 'scheduled'].includes(existing[0].status)) {
      return err(`Cannot edit campaign in '${existing[0].status}' status`)
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

    return ok(result[0])
  } catch (error) {
    console.error('[Marketing] Failed to update campaign:', error)
    return err('Failed to update campaign', 500)
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
      return err('Location ID is required')
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? employeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.MGR_DISCOUNTS)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Cancel: set status to cancelled and soft-delete
    await db.$executeRawUnsafe(`
      UPDATE "MarketingCampaign"
      SET status = 'cancelled', "deletedAt" = NOW(), "updatedAt" = NOW()
      WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
    `, id, locationId)

    return ok({ success: true })
  } catch (error) {
    console.error('[Marketing] Failed to delete campaign:', error)
    return err('Failed to delete campaign', 500)
  }
})
