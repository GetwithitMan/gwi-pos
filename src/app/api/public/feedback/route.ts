import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Simple in-memory rate limiter: 5 submissions per minute per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 })
    return false
  }
  entry.count++
  return entry.count > 5
}

// POST: Public feedback submission (no auth, rate limited)
export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown'

    if (isRateLimited(ip)) {
      return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 })
    }

    const body = await request.json()
    const { locationSlug, orderNumber, rating, comment, customerName, customerEmail } = body

    if (!locationSlug) {
      return NextResponse.json({ error: 'Location is required' }, { status: 400 })
    }
    if (typeof rating !== 'number' || rating < 1 || rating > 10) {
      return NextResponse.json({ error: 'Rating must be between 1 and 10' }, { status: 400 })
    }

    // Resolve locationId from slug
    const locations = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "Location" WHERE "slug" = $1 LIMIT 1`,
      locationSlug,
    )

    if (locations.length === 0) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }
    const locationId = locations[0].id

    // Optionally resolve orderId from orderNumber
    let orderId: string | null = null
    if (orderNumber) {
      const orders = await db.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id" FROM "Order" WHERE "locationId" = $1 AND "orderNumber" = $2 LIMIT 1`,
        locationId,
        parseInt(orderNumber),
      )
      orderId = orders[0]?.id || null
    }

    // Store comment with customer name/email in the comment field for simplicity
    const fullComment = [
      comment,
      customerName ? `— ${customerName}` : null,
      customerEmail ? `(${customerEmail})` : null,
    ].filter(Boolean).join(' ')

    await db.$executeRawUnsafe(
      `INSERT INTO "CustomerFeedback" ("locationId", "orderId", "rating", "comment", "source", "tags")
       VALUES ($1, $2, $3, $4, 'web', '{}'::text[])`,
      locationId,
      orderId,
      rating,
      fullComment || null,
    )

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('[public/feedback/POST] Error:', error)
    return NextResponse.json({ error: 'Failed to submit feedback' }, { status: 500 })
  }
}
