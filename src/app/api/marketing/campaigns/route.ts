import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { mergeWithDefaults } from '@/lib/settings'

// GET - List campaigns for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status')
    const type = searchParams.get('type')
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const where: Record<string, unknown> = {
      locationId,
      deletedAt: null,
    }

    if (status) where.status = status
    if (type) where.type = type
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      }
    }

    const campaigns = await db.$queryRawUnsafe(`
      SELECT
        c.id, c."locationId", c.name, c.type, c.subject, c.segment,
        c.status, c."scheduledFor", c."sentAt", c."createdBy",
        c."recipientCount", c."deliveredCount", c."openCount",
        c."clickCount", c."unsubscribeCount",
        c."createdAt", c."updatedAt"
      FROM "MarketingCampaign" c
      WHERE c."locationId" = $1
        AND c."deletedAt" IS NULL
        ${status ? `AND c.status = $2` : ''}
        ${type ? `AND c.type = ${status ? '$3' : '$2'}` : ''}
      ORDER BY c."createdAt" DESC
    `, locationId, ...(status ? [status] : []), ...(type ? [type] : []))

    return NextResponse.json(campaigns)
  } catch (error) {
    console.error('[Marketing] Failed to list campaigns:', error)
    return NextResponse.json({ error: 'Failed to list campaigns' }, { status: 500 })
  }
})

// POST - Create a new campaign
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      type,
      subject,
      bodyContent,
      segment,
      scheduledFor,
      employeeId,
    } = body

    if (!locationId || !name || !type) {
      return NextResponse.json(
        { error: 'locationId, name, and type are required' },
        { status: 400 }
      )
    }

    if (!['email', 'sms'].includes(type)) {
      return NextResponse.json({ error: 'type must be email or sms' }, { status: 400 })
    }

    // Auth check — require manager permission
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? employeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.MGR_DISCOUNTS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Validate marketing is enabled
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true, name: true },
    })

    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    const settings = mergeWithDefaults(location.settings as Record<string, unknown>)
    const marketing = settings.marketing

    if (!marketing?.enabled) {
      return NextResponse.json({ error: 'Marketing is not enabled for this location' }, { status: 403 })
    }

    if (type === 'sms' && !marketing.smsEnabled) {
      return NextResponse.json({ error: 'SMS campaigns are not enabled' }, { status: 403 })
    }

    if (type === 'email' && !marketing.emailEnabled) {
      return NextResponse.json({ error: 'Email campaigns are not enabled' }, { status: 403 })
    }

    // Create campaign
    const result = await db.$queryRawUnsafe(`
      INSERT INTO "MarketingCampaign"
        ("locationId", "name", "type", "subject", "body", "segment", "status", "scheduledFor", "createdBy")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
      locationId,
      name,
      type,
      subject || null,
      bodyContent || '',
      segment || 'all',
      scheduledFor ? 'scheduled' : 'draft',
      scheduledFor ? new Date(scheduledFor) : null,
      resolvedEmployeeId || null
    ) as unknown[]

    return NextResponse.json({ data: (result as Record<string, unknown>[])[0] })
  } catch (error) {
    console.error('[Marketing] Failed to create campaign:', error)
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 })
  }
})
