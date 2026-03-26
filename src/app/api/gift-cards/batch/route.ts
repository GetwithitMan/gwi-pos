/**
 * Gift Card Batch Actions API
 *
 * POST /api/gift-cards/batch
 *
 * Performs bulk actions on multiple gift cards: activate, freeze, unfreeze, delete.
 * Cards are processed in chunked transactions (100 per chunk) with per-card validation.
 *
 * Body: { action: 'activate'|'freeze'|'unfreeze'|'delete', cardIds: string[], amount?: number, reason?: string }
 * Returns: { succeeded: number, failed: [{cardId, error}] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth, type AuthenticatedContext } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { batchActionSchema } from '@/lib/domain/gift-cards/schemas'
import { activateGiftCard } from '@/lib/domain/gift-cards/activate-gift-card'
import { freezeGiftCard, unfreezeGiftCard } from '@/lib/domain/gift-cards/freeze-gift-card'

const CHUNK_SIZE = 100

interface FailedCard {
  cardId: string
  error: string
}

export const POST = withVenue(withAuth('CUSTOMERS_GIFT_CARDS', async function POST(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const locationId = ctx.auth.locationId
    const employeeId = ctx.auth.employeeId || 'system'
    const body = await request.json()

    const parsed = batchActionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { action, cardIds, amount, reason } = parsed.data

    // Validate action-specific requirements
    if (action === 'activate' && (!amount || amount <= 0)) {
      return NextResponse.json(
        { error: 'Positive amount is required for batch activation' },
        { status: 400 }
      )
    }

    if (action === 'freeze' && !reason) {
      return NextResponse.json(
        { error: 'Reason is required for batch freeze' },
        { status: 400 }
      )
    }

    let succeeded = 0
    const failed: FailedCard[] = []

    // ── Process in chunks of CHUNK_SIZE ──────────────────────────────────
    for (let i = 0; i < cardIds.length; i += CHUNK_SIZE) {
      const chunk = cardIds.slice(i, i + CHUNK_SIZE)

      await db.$transaction(async (tx) => {
        for (const cardId of chunk) {
          try {
            switch (action) {
              case 'activate': {
                const result = await activateGiftCard(tx as any, cardId, amount!, employeeId)
                if (!result.success) {
                  failed.push({ cardId, error: result.error || 'Activation failed' })
                } else {
                  succeeded++
                }
                break
              }

              case 'freeze': {
                const result = await freezeGiftCard(tx as any, cardId, reason!, employeeId)
                if (!result.success) {
                  failed.push({ cardId, error: result.error || 'Freeze failed' })
                } else {
                  succeeded++
                }
                break
              }

              case 'unfreeze': {
                const result = await unfreezeGiftCard(tx as any, cardId, employeeId)
                if (!result.success) {
                  failed.push({ cardId, error: result.error || 'Unfreeze failed' })
                } else {
                  succeeded++
                }
                break
              }

              case 'delete': {
                // Soft delete
                const card = await (tx as any).giftCard.findUnique({ where: { id: cardId } })
                if (!card) {
                  failed.push({ cardId, error: 'Gift card not found' })
                } else if (card.deletedAt) {
                  failed.push({ cardId, error: 'Gift card already deleted' })
                } else {
                  await (tx as any).giftCard.update({
                    where: { id: cardId },
                    data: { deletedAt: new Date() },
                  })
                  succeeded++
                }
                break
              }
            }
          } catch (err) {
            failed.push({ cardId, error: 'Unexpected error processing card' })
          }
        }
      })
    }

    console.log(
      `[AUDIT] GIFT_CARD_BATCH: action=${action}, total=${cardIds.length}, succeeded=${succeeded}, failed=${failed.length}, by employee ${employeeId}`
    )

    void notifyDataChanged({ locationId, domain: 'gift-cards', action: 'updated' })

    return NextResponse.json({ succeeded, failed })
  } catch (error) {
    console.error('Failed to process batch gift card action:', error)
    return NextResponse.json(
      { error: 'Failed to process batch action' },
      { status: 500 }
    )
  }
}))
