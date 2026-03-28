import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'

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

// GET — Get a single upsell rule by ID
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const rows = await db.$queryRawUnsafe<UpsellRuleRow[]>(`
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
      WHERE r."id" = $1 AND r."deletedAt" IS NULL
      LIMIT 1
    `, id)

    if (rows.length === 0) {
      return notFound('Upsell rule not found')
    }

    return ok(serializeRule(rows[0]))
  } catch (error) {
    console.error('Failed to fetch upsell rule:', error)
    return err('Failed to fetch upsell rule', 500)
  }
})

// PUT — Update an upsell rule
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const {
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

    // Verify rule exists
    const existing = await db.$queryRawUnsafe<UpsellRuleRow[]>(`
      SELECT "id" FROM "UpsellRule" WHERE "id" = $1 AND "deletedAt" IS NULL LIMIT 1
    `, id)

    if (existing.length === 0) {
      return notFound('Upsell rule not found')
    }

    if (triggerType) {
      const validTriggerTypes = ['item_added', 'category_match', 'order_total', 'time_of_day', 'no_drink']
      if (!validTriggerTypes.includes(triggerType)) {
        return err(`Invalid triggerType. Must be one of: ${validTriggerTypes.join(', ')}`)
      }
    }

    const rows = await db.$queryRawUnsafe<UpsellRuleRow[]>(`
      UPDATE "UpsellRule" SET
        "name" = COALESCE($2, "name"),
        "triggerType" = COALESCE($3, "triggerType"),
        "triggerItemId" = $4,
        "triggerCategoryId" = $5,
        "triggerMinTotal" = $6,
        "triggerTimeStart" = $7,
        "triggerTimeEnd" = $8,
        "triggerDaysOfWeek" = $9::int[],
        "suggestItemId" = $10,
        "suggestCategoryId" = $11,
        "message" = COALESCE($12, "message"),
        "priority" = COALESCE($13, "priority"),
        "isActive" = COALESCE($14, "isActive"),
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = $1 AND "deletedAt" IS NULL
      RETURNING *
    `,
      id,
      name ?? null,
      triggerType ?? null,
      triggerItemId !== undefined ? (triggerItemId || null) : null,
      triggerCategoryId !== undefined ? (triggerCategoryId || null) : null,
      triggerMinTotal !== undefined ? triggerMinTotal : null,
      triggerTimeStart !== undefined ? (triggerTimeStart || null) : null,
      triggerTimeEnd !== undefined ? (triggerTimeEnd || null) : null,
      triggerDaysOfWeek && triggerDaysOfWeek.length > 0 ? triggerDaysOfWeek : null,
      suggestItemId !== undefined ? (suggestItemId || null) : null,
      suggestCategoryId !== undefined ? (suggestCategoryId || null) : null,
      message ?? null,
      priority ?? null,
      isActive ?? null,
    )

    if (rows.length === 0) {
      return notFound('Upsell rule not found')
    }

    return ok(serializeRule(rows[0]))
  } catch (error) {
    console.error('Failed to update upsell rule:', error)
    return err('Failed to update upsell rule', 500)
  }
}))

// DELETE — Soft-delete an upsell rule
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const rows = await db.$queryRawUnsafe<UpsellRuleRow[]>(`
      UPDATE "UpsellRule"
      SET "deletedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = $1 AND "deletedAt" IS NULL
      RETURNING "id"
    `, id)

    if (rows.length === 0) {
      return notFound('Upsell rule not found')
    }

    return ok({ success: true })
  } catch (error) {
    console.error('Failed to delete upsell rule:', error)
    return err('Failed to delete upsell rule', 500)
  }
}))
