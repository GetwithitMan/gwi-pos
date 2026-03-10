import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

/** Build parameterized WHERE clause from optional filters */
function buildWhereClause(
  locationId: string,
  startDate: string | null,
  endDate: string | null,
  rating: number | null,
  source: string | null,
  tag: string | null,
): { clause: string; values: unknown[] } {
  const conditions = ['"locationId" = $1', '"deletedAt" IS NULL']
  const values: unknown[] = [locationId]
  let idx = 2

  if (startDate) {
    conditions.push(`"createdAt" >= $${idx}::timestamp`)
    values.push(new Date(startDate))
    idx++
  }
  if (endDate) {
    conditions.push(`"createdAt" <= $${idx}::timestamp`)
    values.push(new Date(endDate + 'T23:59:59'))
    idx++
  }
  if (rating !== null) {
    conditions.push(`"rating" = $${idx}`)
    values.push(rating)
    idx++
  }
  if (source) {
    conditions.push(`"source" = $${idx}`)
    values.push(source)
    idx++
  }
  if (tag) {
    conditions.push(`$${idx} = ANY("tags")`)
    values.push(tag)
    idx++
  }

  return { clause: conditions.join(' AND '), values }
}

// GET: List feedback with aggregates
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const locationId = params.get('locationId')
    const startDate = params.get('startDate')
    const endDate = params.get('endDate')
    const rating = params.get('rating') ? parseInt(params.get('rating')!) : null
    const source = params.get('source')
    const tag = params.get('tag')
    const requestingEmployeeId = params.get('requestingEmployeeId') || params.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_VIEW)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { clause, values } = buildWhereClause(locationId, startDate, endDate, rating, source, tag)

    // Fetch feedback entries
    const entries = await db.$queryRawUnsafe<Array<{
      id: string
      locationId: string
      orderId: string | null
      customerId: string | null
      employeeId: string | null
      rating: number
      comment: string | null
      source: string
      tags: string[]
      createdAt: Date
    }>>(
      `SELECT * FROM "CustomerFeedback" WHERE ${clause} ORDER BY "createdAt" DESC LIMIT 500`,
      ...values,
    )

    // Aggregates (date-filtered only, ignoring rating/source/tag filters for global view)
    const { clause: aggClause, values: aggValues } = buildWhereClause(locationId, startDate, endDate, null, null, null)

    const aggs = await db.$queryRawUnsafe<Array<{
      count: bigint
      avg_rating: number | null
      rating_1: bigint
      rating_2: bigint
      rating_3: bigint
      rating_4: bigint
      rating_5: bigint
      promoters: bigint
      detractors: bigint
    }>>(
      `SELECT
        COUNT(*) as count,
        AVG(rating::float) as avg_rating,
        COUNT(*) FILTER (WHERE rating = 1) as rating_1,
        COUNT(*) FILTER (WHERE rating = 2) as rating_2,
        COUNT(*) FILTER (WHERE rating = 3) as rating_3,
        COUNT(*) FILTER (WHERE rating = 4) as rating_4,
        COUNT(*) FILTER (WHERE rating = 5) as rating_5,
        COUNT(*) FILTER (WHERE rating >= 4) as promoters,
        COUNT(*) FILTER (WHERE rating <= 2) as detractors
       FROM "CustomerFeedback" WHERE ${aggClause}`,
      ...aggValues,
    )

    const agg = aggs[0]
    const totalCount = Number(agg?.count ?? 0)
    const avgRating = agg?.avg_rating ? Math.round(agg.avg_rating * 100) / 100 : 0
    const promoters = Number(agg?.promoters ?? 0)
    const detractors = Number(agg?.detractors ?? 0)
    const npsScore = totalCount > 0
      ? Math.round(((promoters - detractors) / totalCount) * 100)
      : 0

    // Top tags
    const topTags = await db.$queryRawUnsafe<Array<{ tag: string; count: bigint }>>(
      `SELECT unnest(tags) as tag, COUNT(*) as count
       FROM "CustomerFeedback" WHERE ${aggClause}
       GROUP BY tag ORDER BY count DESC LIMIT 20`,
      ...aggValues,
    )

    return NextResponse.json({
      data: {
        entries,
        aggregates: {
          totalCount,
          averageRating: avgRating,
          npsScore,
          ratingDistribution: {
            1: Number(agg?.rating_1 ?? 0),
            2: Number(agg?.rating_2 ?? 0),
            3: Number(agg?.rating_3 ?? 0),
            4: Number(agg?.rating_4 ?? 0),
            5: Number(agg?.rating_5 ?? 0),
          },
          topTags: topTags.map(t => ({ tag: t.tag, count: Number(t.count) })),
        },
      },
    })
  } catch (error) {
    console.error('[feedback/GET] Error:', error)
    return NextResponse.json({ error: 'Failed to load feedback' }, { status: 500 })
  }
})

// POST: Submit feedback
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { orderId, customerId, rating, comment, tags, source, employeeId, locationId } = body

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }
    if (typeof rating !== 'number' || rating < 1 || rating > 10) {
      return NextResponse.json({ error: 'Rating must be between 1 and 10' }, { status: 400 })
    }
    if (!source || !['in_store', 'sms', 'email', 'web'].includes(source)) {
      return NextResponse.json({ error: 'Valid source is required (in_store, sms, email, web)' }, { status: 400 })
    }

    // Validate and filter tags to allowed values
    const allowedTags = ['food_quality', 'service', 'ambiance', 'speed', 'value', 'cleanliness', 'portion_size', 'drinks', 'atmosphere']
    const validTags: string[] = Array.isArray(tags)
      ? tags.filter((t: string) => allowedTags.includes(t))
      : []

    const result = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "CustomerFeedback" ("locationId", "orderId", "customerId", "employeeId", "rating", "comment", "source", "tags")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[])
       RETURNING "id"`,
      locationId,
      orderId || null,
      customerId || null,
      employeeId || null,
      rating,
      comment || null,
      source,
      validTags,
    )

    // Fire-and-forget: alert on low ratings
    if (rating <= 2) {
      void import('@/lib/alert-service').then(({ dispatchAlert }) => {
        dispatchAlert({
          severity: 'MEDIUM',
          errorType: 'low_customer_feedback',
          category: 'customer_feedback',
          message: `Low feedback rating (${rating}/5)${comment ? `: "${comment.substring(0, 100)}"` : ''} — ${source}`,
          locationId,
          orderId: orderId || undefined,
          employeeId: employeeId || undefined,
          groupId: `feedback-low-${locationId}`,
        })
      }).catch(console.error)
    }

    return NextResponse.json({ data: { id: result[0]?.id, success: true } })
  } catch (error) {
    console.error('[feedback/POST] Error:', error)
    return NextResponse.json({ error: 'Failed to submit feedback' }, { status: 500 })
  }
})
