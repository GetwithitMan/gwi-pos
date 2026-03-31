import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, ok } from '@/lib/api-response'

interface UpsellRuleRow {
  id: string
  locationId: string
  name: string
  triggerType: string
  triggerItemId: string | null
  triggerCategoryId: string | null
  triggerMinTotal: number | null
  triggerTimeStart: string | null
  triggerTimeEnd: string | null
  triggerDaysOfWeek: number[] | null
  suggestItemId: string | null
  suggestCategoryId: string | null
  message: string
  priority: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

function serializeRule(row: UpsellRuleRow) {
  return {
    ...row,
    triggerMinTotal: row.triggerMinTotal != null ? Number(row.triggerMinTotal) : null,
  }
}

// GET — List all upsell rules for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return err('Location ID is required')
    }

    const rows = await db.$queryRaw<UpsellRuleRow[]>`
      SELECT r.*,
        ti."name" as "triggerItemName",
        si."name" as "suggestItemName",
        si."basePrice" as "suggestItemPrice",
        tc."name" as "triggerCategoryName",
        sc."name" as "suggestCategoryName"
      FROM "UpsellRule" r
      LEFT JOIN "MenuItem" ti ON r."triggerItemId" = ti."id"
      LEFT JOIN "MenuItem" si ON r."suggestItemId" = si."id"
      LEFT JOIN "Category" tc ON r."triggerCategoryId" = tc."id"
      LEFT JOIN "Category" sc ON r."suggestCategoryId" = sc."id"
      WHERE r."locationId" = ${locationId} AND r."deletedAt" IS NULL
      ORDER BY r."priority" DESC, r."name" ASC
    `

    return ok(rows.map(serializeRule))
  } catch (error) {
    console.error('Failed to fetch upsell rules:', error)
    return err('Failed to fetch upsell rules', 500)
  }
})

// POST — Create a new upsell rule
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      triggerType,
      triggerItemId,
      triggerCategoryId,
      triggerMinTotal,
      triggerTimeStart,
      triggerTimeEnd,
      triggerDaysOfWeek,
      suggestItemId,
      suggestCategoryId,
      message,
      priority,
      isActive,
    } = body

    if (!locationId || !name || !triggerType) {
      return err('locationId, name, and triggerType are required')
    }

    // Must have at least one suggestion target
    if (!suggestItemId && !suggestCategoryId) {
      return err('Either suggestItemId or suggestCategoryId is required')
    }

    const validTriggerTypes = ['item_added', 'category_match', 'order_total', 'time_of_day', 'no_drink']
    if (!validTriggerTypes.includes(triggerType)) {
      return err(`Invalid triggerType. Must be one of: ${validTriggerTypes.join(', ')}`)
    }

    const rows = await db.$queryRaw<UpsellRuleRow[]>`
      INSERT INTO "UpsellRule" (
        "locationId", "name", "triggerType",
        "triggerItemId", "triggerCategoryId", "triggerMinTotal",
        "triggerTimeStart", "triggerTimeEnd", "triggerDaysOfWeek",
        "suggestItemId", "suggestCategoryId",
        "message", "priority", "isActive"
      ) VALUES (${locationId}, ${name}, ${triggerType}, ${triggerItemId || null}, ${triggerCategoryId || null}, ${triggerMinTotal != null ? triggerMinTotal : null}, ${triggerTimeStart || null}, ${triggerTimeEnd || null}, ${triggerDaysOfWeek && triggerDaysOfWeek.length > 0 ? triggerDaysOfWeek : null}::int[], ${suggestItemId || null}, ${suggestCategoryId || null}, ${message || ''}, ${priority ?? 0}, ${isActive !== false})
      RETURNING *
    `

    return ok(serializeRule(rows[0]))
  } catch (error) {
    console.error('Failed to create upsell rule:', error)
    return err('Failed to create upsell rule', 500)
  }
}))
