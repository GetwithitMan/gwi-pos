/**
 * PATCH /api/public/portal/[slug]/quote/[qid]/accept — Accept a cake quote
 *
 * Token-authenticated via ?token= query param (HMAC-signed order view link).
 * Transitions quote → approved, order → approved. Emits socket event.
 */

import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { getDbForVenue } from '@/lib/db'
import { verifyOrderViewToken } from '@/lib/portal-auth'
import { dispatchCakeOrderUpdated } from '@/lib/socket-dispatch'
import { err, forbidden, notFound, ok } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  context: any,
) {
  try {
    const { slug, qid } = (await context.params) as { slug: string; qid: string }

    if (!slug) {
      return err('Venue slug is required')
    }
    if (!qid) {
      return err('Quote ID is required')
    }

    // ── Validate token ─────────────────────────────────────────────
    const token = request.nextUrl.searchParams.get('token')
    if (!token) {
      return forbidden('Access token is required')
    }

    const tokenResult = verifyOrderViewToken(token)
    if (!tokenResult.valid && tokenResult.expired) {
      return err('This link has expired. Please request a new one.', 410)
    }
    if (!tokenResult.valid) {
      return forbidden('Invalid access token')
    }

    // ── Resolve venue DB ───────────────────────────────────────────
    let venueDb
    try {
      venueDb = await getDbForVenue(slug)
    } catch {
      return notFound('Location not found')
    }

    // ── Get location ─────────────────────────────────────────────
    const location = await venueDb.location.findFirst({
      where: { isActive: true },
      select: { id: true },
    })

    if (!location) {
      return notFound('Location not found')
    }

    const locationId = location.id

    // ── Fetch CakeQuote ────────────────────────────────────────────
    const quotes = await venueDb.$queryRaw<
      Array<{ id: string; cakeOrderId: string; status: string; validUntilDate: Date | null }>>`SELECT q."id", q."cakeOrderId", q."status", q."validUntilDate"
       FROM "CakeQuote" q
       JOIN "CakeOrder" o ON o."id" = q."cakeOrderId"
       WHERE q."id" = ${qid}
         AND o."customerId" = ${tokenResult.customerId}
         AND o."deletedAt" IS NULL`

    if (quotes.length === 0) {
      return notFound('Quote not found')
    }

    const quote = quotes[0]

    // ── Check quote is still active ────────────────────────────────
    if (quote.status === 'voided') {
      return err('Quote no longer active. It has been voided.', 410)
    }

    if (quote.status === 'expired') {
      return err('Quote no longer active. It has expired.', 410)
    }

    // Check validUntilDate expiry
    if (quote.validUntilDate) {
      const validUntil = new Date(quote.validUntilDate)
      validUntil.setHours(23, 59, 59, 999) // end of day
      if (new Date() > validUntil) {
        return err('Quote no longer active. It has expired.', 410)
      }
    }

    // ── Already approved — idempotent success ──────────────────────
    if (quote.status === 'approved') {
      return ok({
        success: true,
        status: 'approved',
        message: 'Quote already accepted.',
      })
    }

    // ── Update quote → approved ────────────────────────────────────
    await venueDb.$executeRaw`UPDATE "CakeQuote"
       SET "status" = 'approved', "approvedAt" = NOW(), "updatedAt" = NOW()
       WHERE "id" = ${qid}`

    // ── Update order → approved ────────────────────────────────────
    await venueDb.$executeRaw`UPDATE "CakeOrder"
       SET "status" = 'approved', "approvedAt" = NOW(), "updatedAt" = NOW()
       WHERE "id" = ${quote.cakeOrderId}`

    // ── Insert CakeOrderChange (audit trail) ───────────────────────
    const changeId = crypto.randomUUID()
    await venueDb.$executeRaw`INSERT INTO "CakeOrderChange" (
        "id", "cakeOrderId", "changeType", "changedBy", "source",
        "details", "createdAt"
      ) VALUES (
        ${changeId}, ${quote.cakeOrderId}, 'quote_approved', NULL, 'customer_portal',
        ${JSON.stringify({
        quoteId: qid,
        previousStatus: quote.status,
        newStatus: 'approved',
        trigger: 'customer_portal_acceptance',
      })}::jsonb, NOW()
      )`

    // ── Socket event (fire-and-forget) ─────────────────────────────
    void dispatchCakeOrderUpdated(locationId, {
      cakeOrderId: quote.cakeOrderId,
      status: 'approved',
      changeType: 'quote_approved',
    }).catch(err => console.error('[portal-quote-accept] Socket dispatch failed:', err))

    return ok({
      success: true,
      status: 'approved',
    })
  } catch (error) {
    console.error('[PATCH /api/public/portal/[slug]/quote/[qid]/accept] Error:', error)
    return err('Failed to accept quote', 500)
  }
}
