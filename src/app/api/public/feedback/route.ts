import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { createRateLimiter } from '@/lib/rate-limiter'
import { getClientIp } from '@/lib/get-client-ip'
import { err, notFound, ok } from '@/lib/api-response'

// Rate limiter: 5 submissions per minute per IP
const limiter = createRateLimiter({ maxAttempts: 5, windowMs: 60_000 })

// POST: Public feedback submission (no auth, rate limited)
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)

    const rateCheck = limiter.check(ip)
    if (!rateCheck.allowed) {
      return err('Too many requests. Please wait a moment.', 429)
    }

    const body = await request.json()
    const { locationSlug, orderNumber, rating, comment, customerName, customerEmail } = body

    if (!locationSlug) {
      return err('Location is required')
    }
    if (typeof rating !== 'number' || rating < 1 || rating > 10) {
      return err('Rating must be between 1 and 10')
    }

    // Resolve locationId from slug
    const locations = await db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Location" WHERE "slug" = ${locationSlug} LIMIT 1`

    if (locations.length === 0) {
      return notFound('Location not found')
    }
    const locationId = locations[0].id

    // Optionally resolve orderId from orderNumber
    let orderId: string | null = null
    if (orderNumber) {
      const orders = await db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Order" WHERE "locationId" = ${locationId} AND "orderNumber" = ${parseInt(orderNumber)} LIMIT 1`
      orderId = orders[0]?.id || null
    }

    // Store comment with customer name/email in the comment field for simplicity
    const fullComment = [
      comment,
      customerName ? `— ${customerName}` : null,
      customerEmail ? `(${customerEmail})` : null,
    ].filter(Boolean).join(' ')

    await db.$executeRaw`INSERT INTO "CustomerFeedback" ("locationId", "orderId", "rating", "comment", "source", "tags")
       VALUES (${locationId}, ${orderId}, ${rating}, ${fullComment || null}, 'web', '{}'::text[])`

    return ok({ success: true })
  } catch (error) {
    console.error('[public/feedback/POST] Error:', error)
    return err('Failed to submit feedback', 500)
  }
}
