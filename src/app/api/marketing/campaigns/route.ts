import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { mergeWithDefaults } from '@/lib/settings'
import { err, forbidden, notFound, ok } from '@/lib/api-response'

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
      return err('Location ID is required')
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

    // eslint-disable-next-line -- conditional WHERE clauses with dynamic positional params require $queryRawUnsafe; all values are parameterized
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

    return ok(campaigns)
  } catch (error) {
    console.error('[Marketing] Failed to list campaigns:', error)
    return err('Failed to list campaigns', 500)
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
      return err('locationId, name, and type are required')
    }

    if (!['email', 'sms'].includes(type)) {
      return err('type must be email or sms')
    }

    // Auth check — require manager permission
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? employeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.MGR_DISCOUNTS)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Validate marketing is enabled
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true, name: true },
    })

    if (!location) {
      return notFound('Location not found')
    }

    const settings = mergeWithDefaults(location.settings as Record<string, unknown>)
    const marketing = settings.marketing

    if (!marketing?.enabled) {
      return forbidden('Marketing is not enabled for this location')
    }

    if (type === 'sms' && !marketing.smsEnabled) {
      return forbidden('SMS campaigns are not enabled')
    }

    if (type === 'email' && !marketing.emailEnabled) {
      return forbidden('Email campaigns are not enabled')
    }

    // Create campaign
    const result = await db.$queryRaw`
      INSERT INTO "MarketingCampaign"
        ("locationId", "name", "type", "subject", "body", "segment", "status", "scheduledFor", "createdBy")
      VALUES (${locationId}, ${name}, ${type}, ${subject || null}, ${bodyContent || ''}, ${segment || 'all'}, ${scheduledFor ? 'scheduled' : 'draft'}, ${scheduledFor ? new Date(scheduledFor) : null}, ${resolvedEmployeeId || null})
      RETURNING *
    ` as unknown[]

    return ok((result as Record<string, unknown>[]))
  } catch (error) {
    console.error('[Marketing] Failed to create campaign:', error)
    return err('Failed to create campaign', 500)
  }
})
