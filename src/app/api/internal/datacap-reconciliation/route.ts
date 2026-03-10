import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/internal/datacap-reconciliation
 *
 * List orphaned or stale pending Datacap sales that may represent charges
 * where the server died before returning the recordNo to the client.
 *
 * Query params:
 *   status   - Filter by status: 'pending' | 'orphaned' | 'all' (default: 'all')
 *   minAge   - Minimum age in seconds (default: 120 — only show records older than 2 min)
 *
 * POST /api/internal/datacap-reconciliation
 *
 * Mark a specific pending sale as voided (after manual Datacap void in portal).
 *
 * Body: { id: string, resolution: 'voided' | 'resolved' | 'false_positive', note?: string }
 *
 * Auth: INTERNAL_API_SECRET via x-api-key header
 */

function authorize(request: NextRequest | Request): boolean {
  const apiKey = request.headers.get('x-api-key') || request.headers.get('authorization')?.replace('Bearer ', '')
  if (apiKey && apiKey === process.env.INTERNAL_API_SECRET) {
    return true
  }
  // Allow localhost for backward compatibility
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || ''
  return ['127.0.0.1', '::1', 'localhost'].includes(ip)
}

export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const status = request.nextUrl.searchParams.get('status') || 'all'
  const minAge = Math.max(0, Math.min(86400, parseInt(request.nextUrl.searchParams.get('minAge') || '120', 10) || 120))

  try {
    // Build status filter — parameterized values prevent injection
    let query: string
    const params: unknown[] = [minAge]

    if (status === 'pending') {
      query = `SELECT * FROM "_pending_datacap_sales"
       WHERE "createdAt" < NOW() - make_interval(secs => $1::int)
       AND "status" = 'pending'
       ORDER BY "createdAt" DESC LIMIT 100`
    } else if (status === 'orphaned') {
      query = `SELECT * FROM "_pending_datacap_sales"
       WHERE "createdAt" < NOW() - make_interval(secs => $1::int)
       AND "status" = 'orphaned'
       ORDER BY "createdAt" DESC LIMIT 100`
    } else {
      query = `SELECT * FROM "_pending_datacap_sales"
       WHERE "createdAt" < NOW() - make_interval(secs => $1::int)
       AND "status" IN ('pending', 'orphaned')
       ORDER BY "createdAt" DESC LIMIT 100`
    }

    const rows = await db.$queryRawUnsafe<Array<{
      id: string
      orderId: string
      terminalId: string
      invoiceNo: string | null
      amount: unknown
      status: string
      datacapRecordNo: string | null
      datacapRefNumber: string | null
      createdAt: Date
      resolvedAt: Date | null
      locationId: string
    }>>(query, ...params)

    return NextResponse.json({
      count: rows.length,
      sales: rows.map(r => ({
        ...r,
        amount: Number(r.amount),
      })),
    })
  } catch (error) {
    // Table may not exist yet (migration not run)
    if (error instanceof Error && error.message.includes('_pending_datacap_sales')) {
      return NextResponse.json({ count: 0, sales: [], note: 'Table not yet created — run migrations' })
    }
    return NextResponse.json({ error: 'Failed to query reconciliation data' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  if (!authorize(request as NextRequest)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { id, resolution, note } = body as { id?: string; resolution?: string; note?: string }

    if (!id || !resolution) {
      return NextResponse.json({ error: 'Missing required fields: id, resolution' }, { status: 400 })
    }

    const validResolutions = ['voided', 'resolved', 'false_positive']
    if (!validResolutions.includes(resolution)) {
      return NextResponse.json(
        { error: `Invalid resolution. Must be one of: ${validResolutions.join(', ')}` },
        { status: 400 }
      )
    }

    const result = await db.$executeRawUnsafe(
      `UPDATE "_pending_datacap_sales" SET "status" = $2, "resolvedAt" = NOW() WHERE id = $1 AND "status" IN ('pending', 'orphaned')`,
      id, resolution
    )

    if (result === 0) {
      return NextResponse.json({ error: 'Record not found or already resolved' }, { status: 404 })
    }

    console.log(`[Datacap Reconciliation] Sale ${id} marked as ${resolution}${note ? `: ${note}` : ''}`)

    return NextResponse.json({ success: true, id, resolution })
  } catch (error) {
    console.error('[Datacap Reconciliation] POST error:', error)
    return NextResponse.json({ error: 'Failed to update reconciliation record' }, { status: 500 })
  }
}
