/**
 * PATCH /api/public/portal/[slug]/quote/[qid]/accept — Accept a cake quote
 *
 * Token-authenticated via ?token= query param (HMAC-signed order view link).
 * Transitions quote → approved, order → approved. Emits socket event.
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getDbForVenue } from '@/lib/db'
import { verifyOrderViewToken } from '@/lib/portal-auth'
import { dispatchCakeOrderUpdated } from '@/lib/socket-dispatch'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  context: any,
) {
  try {
    const { slug, qid } = (await context.params) as { slug: string; qid: string }

    if (!slug) {
      return NextResponse.json({ error: 'Venue slug is required' }, { status: 400 })
    }
    if (!qid) {
      return NextResponse.json({ error: 'Quote ID is required' }, { status: 400 })
    }

    // ── Validate token ─────────────────────────────────────────────
    const token = request.nextUrl.searchParams.get('token')
    if (!token) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 403 })
    }

    const tokenResult = verifyOrderViewToken(token)
    if (!tokenResult.valid && tokenResult.expired) {
      return NextResponse.json(
        { error: 'This link has expired. Please request a new one.' },
        { status: 410 },
      )
    }
    if (!tokenResult.valid) {
      return NextResponse.json({ error: 'Invalid access token' }, { status: 403 })
    }

    // ── Resolve venue DB ───────────────────────────────────────────
    let venueDb
    try {
      venueDb = await getDbForVenue(slug)
    } catch {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    // ── Get location ─────────────────────────────────────────────
    const location = await venueDb.location.findFirst({
      where: { isActive: true },
      select: { id: true },
    })

    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    const locationId = location.id

    // ── Fetch CakeQuote ────────────────────────────────────────────
    const quotes = await venueDb.$queryRawUnsafe<
      Array<{ id: string; cakeOrderId: string; status: string; validUntilDate: Date | null }>
    >(
      `SELECT q."id", q."cakeOrderId", q."status", q."validUntilDate"
       FROM "CakeQuote" q
       JOIN "CakeOrder" o ON o."id" = q."cakeOrderId"
       WHERE q."id" = $1
         AND o."customerId" = $2
         AND o."deletedAt" IS NULL`,
      qid,
      tokenResult.customerId,
    )

    if (quotes.length === 0) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    }

    const quote = quotes[0]

    // ── Check quote is still active ────────────────────────────────
    if (quote.status === 'voided') {
      return NextResponse.json(
        { error: 'Quote no longer active. It has been voided.' },
        { status: 410 },
      )
    }

    if (quote.status === 'expired') {
      return NextResponse.json(
        { error: 'Quote no longer active. It has expired.' },
        { status: 410 },
      )
    }

    // Check validUntilDate expiry
    if (quote.validUntilDate) {
      const validUntil = new Date(quote.validUntilDate)
      validUntil.setHours(23, 59, 59, 999) // end of day
      if (new Date() > validUntil) {
        return NextResponse.json(
          { error: 'Quote no longer active. It has expired.' },
          { status: 410 },
        )
      }
    }

    // ── Already approved — idempotent success ──────────────────────
    if (quote.status === 'approved') {
      return NextResponse.json({
        success: true,
        status: 'approved',
        message: 'Quote already accepted.',
      })
    }

    // ── Update quote → approved ────────────────────────────────────
    await venueDb.$executeRawUnsafe(
      `UPDATE "CakeQuote"
       SET "status" = 'approved', "approvedAt" = NOW(), "updatedAt" = NOW()
       WHERE "id" = $1`,
      qid,
    )

    // ── Update order → approved ────────────────────────────────────
    await venueDb.$executeRawUnsafe(
      `UPDATE "CakeOrder"
       SET "status" = 'approved', "approvedAt" = NOW(), "updatedAt" = NOW()
       WHERE "id" = $1`,
      quote.cakeOrderId,
    )

    // ── Insert CakeOrderChange (audit trail) ───────────────────────
    const changeId = crypto.randomUUID()
    await venueDb.$executeRawUnsafe(
      `INSERT INTO "CakeOrderChange" (
        "id", "cakeOrderId", "changeType", "changedBy", "source",
        "details", "createdAt"
      ) VALUES (
        $1, $2, 'quote_approved', NULL, 'customer_portal',
        $3::jsonb, NOW()
      )`,
      changeId,
      quote.cakeOrderId,
      JSON.stringify({
        quoteId: qid,
        previousStatus: quote.status,
        newStatus: 'approved',
        trigger: 'customer_portal_acceptance',
      }),
    )

    // ── Socket event (fire-and-forget) ─────────────────────────────
    void dispatchCakeOrderUpdated(locationId, {
      cakeOrderId: quote.cakeOrderId,
      status: 'approved',
      changeType: 'quote_approved',
    }).catch(err => console.error('[portal-quote-accept] Socket dispatch failed:', err))

    return NextResponse.json({
      success: true,
      status: 'approved',
    })
  } catch (error) {
    console.error('[PATCH /api/public/portal/[slug]/quote/[qid]/accept] Error:', error)
    return NextResponse.json({ error: 'Failed to accept quote' }, { status: 500 })
  }
}
