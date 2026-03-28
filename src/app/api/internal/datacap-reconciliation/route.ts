import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getClientIp } from '@/lib/get-client-ip'
import { err, notFound, ok, unauthorized } from '@/lib/api-response'

// TODO (PAY-P2-4): Add a scheduled cron route (/api/cron/datacap-reconciliation) that:
// 1. Finds orphaned _pending_datacap_sales rows older than 5 minutes with status='pending'
// 2. Logs them at CRITICAL level for operator review
// 3. Optionally auto-voids via DatacapClient.voidSale() using the stored datacapRecordNo
//    (requires careful orchestration — currently manual-only via POST resolution below)
// 4. Marks them as status='orphaned' so the existing GET endpoint surfaces them
// The eod-batch-close cron already handles batch settlement, so this should run more
// frequently (every 5 minutes) as a separate Vercel cron.

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

function authorize(request: NextRequest): boolean {
  const apiKey = request.headers.get('x-api-key') || request.headers.get('authorization')?.replace('Bearer ', '')
  if (apiKey && apiKey === process.env.INTERNAL_API_SECRET) {
    return true
  }
  // Allow localhost for backward compatibility
  const ip = getClientIp(request)
  return ['127.0.0.1', '::1', 'localhost'].includes(ip)
}

export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return unauthorized('Unauthorized')
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

    return ok({
      count: rows.length,
      sales: rows.map(r => ({
        ...r,
        amount: Number(r.amount),
      })),
    })
  } catch (error) {
    // Table may not exist yet (migration not run)
    if (error instanceof Error && error.message.includes('_pending_datacap_sales')) {
      return ok({ count: 0, sales: [], note: 'Table not yet created — run migrations' })
    }
    return err('Failed to query reconciliation data', 500)
  }
}

/**
 * PUT /api/internal/datacap-reconciliation
 *
 * PAY-P2-4: Auto-detect and mark orphaned pending Datacap sales.
 * Finds pending sales older than 5 minutes and marks them as 'orphaned'.
 * Logs at CRITICAL level for operator awareness. Designed to be called
 * periodically (e.g., every 5 minutes from a health check or cron).
 */
export async function PUT(request: NextRequest) {
  if (!authorize(request)) {
    return unauthorized('Unauthorized')
  }

  try {
    // Find and mark stale pending sales as orphaned (older than 5 minutes)
    const orphaned = await db.$queryRawUnsafe<Array<{
      id: string
      orderId: string
      terminalId: string
      amount: unknown
      datacapRecordNo: string | null
      locationId: string
      createdAt: Date
    }>>(
      `UPDATE "_pending_datacap_sales"
       SET "status" = 'orphaned'
       WHERE "status" = 'pending'
         AND "createdAt" < NOW() - INTERVAL '5 minutes'
       RETURNING id, "orderId", "terminalId", amount, "datacapRecordNo", "locationId", "createdAt"`
    )

    if (orphaned.length > 0) {
      console.error(
        `[DATACAP-RECONCILIATION] CRITICAL: ${orphaned.length} orphaned pending Datacap sale(s) detected. ` +
        `These may represent charges where the server died before recording the result. ` +
        `IDs: ${orphaned.map(o => o.id).join(', ')}. ` +
        `RecordNos: ${orphaned.map(o => o.datacapRecordNo || 'none').join(', ')}. ` +
        `Manual review required via GET /api/internal/datacap-reconciliation`
      )
    }

    return ok({
      orphanedCount: orphaned.length,
      orphaned: orphaned.map(o => ({
        id: o.id,
        orderId: o.orderId,
        terminalId: o.terminalId,
        amount: Number(o.amount),
        datacapRecordNo: o.datacapRecordNo,
        locationId: o.locationId,
      })),
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('_pending_datacap_sales')) {
      return ok({ orphanedCount: 0, orphaned: [], note: 'Table not yet created' })
    }
    console.error('[Datacap Reconciliation] PUT error:', error)
    return err('Failed to run orphan detection', 500)
  }
}

export async function POST(request: Request) {
  if (!authorize(request as NextRequest)) {
    return unauthorized('Unauthorized')
  }

  try {
    const body = await request.json()
    const { id, resolution, note } = body as { id?: string; resolution?: string; note?: string }

    if (!id || !resolution) {
      return err('Missing required fields: id, resolution')
    }

    const validResolutions = ['voided', 'resolved', 'false_positive']
    if (!validResolutions.includes(resolution)) {
      return err(`Invalid resolution. Must be one of: ${validResolutions.join(', ')}`)
    }

    const result = await db.$executeRawUnsafe(
      `UPDATE "_pending_datacap_sales" SET "status" = $2, "resolvedAt" = NOW() WHERE id = $1 AND "status" IN ('pending', 'orphaned')`,
      id, resolution
    )

    if (result === 0) {
      return notFound('Record not found or already resolved')
    }

    return ok({ success: true })
  } catch (error) {
    console.error('[Datacap Reconciliation] POST error:', error)
    return err('Failed to update reconciliation record', 500)
  }
}
