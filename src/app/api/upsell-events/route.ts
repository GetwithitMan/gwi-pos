import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

interface UpsellEventRow {
  id: string
  locationId: string
  upsellRuleId: string
  orderId: string
  employeeId: string | null
  suggestedItemId: string | null
  suggestedItemName: string | null
  suggestedItemPrice: number | null
  action: string
  addedAmount: number | null
  createdAt: Date
}

// POST — Record an upsell event (shown, accepted, dismissed)
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      ruleId,
      orderId,
      employeeId,
      suggestedItemId,
      suggestedItemName,
      suggestedItemPrice,
      action,
      addedAmount,
    } = body

    if (!locationId || !ruleId || !orderId || !action) {
      return NextResponse.json(
        { error: 'locationId, ruleId, orderId, and action are required' },
        { status: 400 }
      )
    }

    const validActions = ['shown', 'accepted', 'dismissed']
    if (!validActions.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${validActions.join(', ')}` },
        { status: 400 }
      )
    }

    const rows = await db.$queryRawUnsafe<UpsellEventRow[]>(`
      INSERT INTO "UpsellEvent" (
        "locationId", "upsellRuleId", "orderId", "employeeId",
        "suggestedItemId", "suggestedItemName", "suggestedItemPrice",
        "action", "addedAmount"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
      locationId,
      ruleId,
      orderId,
      employeeId || null,
      suggestedItemId || null,
      suggestedItemName || null,
      suggestedItemPrice != null ? suggestedItemPrice : null,
      action,
      addedAmount != null ? addedAmount : null,
    )

    return NextResponse.json({ data: { success: true, id: rows[0]?.id } })
  } catch (error) {
    console.error('Failed to record upsell event:', error)
    return NextResponse.json({ error: 'Failed to record upsell event' }, { status: 500 })
  }
})
