import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/auth'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'

/**
 * GET /api/admin/sync-audit
 *
 * Fetches sync audit log entries for the admin dashboard.
 * This is the "Timeline of Truth" for dispute resolution.
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }
    const dateStr = searchParams.get('date') // YYYY-MM-DD
    const terminalId = searchParams.get('terminalId')
    const status = searchParams.get('status')
    const limit = parseInt(searchParams.get('limit') || '100', 10)

    // Build date filter
    let dateFilter = {}
    if (dateStr) {
      const date = new Date(dateStr)
      const nextDay = new Date(date)
      nextDay.setDate(nextDay.getDate() + 1)
      dateFilter = {
        createdAt: {
          gte: date,
          lt: nextDay,
        },
      }
    } else {
      // Default to today
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)
      dateFilter = {
        createdAt: {
          gte: today,
          lt: tomorrow,
        },
      }
    }

    // Build where clause
    const where: any = {
      locationId,
      deletedAt: null,
      ...dateFilter,
    }

    if (terminalId) {
      where.terminalId = terminalId
    }

    if (status) {
      where.status = status
    }

    // Fetch audit entries
    const entries = await db.syncAuditEntry.findMany({
      where,
      include: {
        order: {
          select: { id: true, orderNumber: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    // Transform for the frontend
    const logs = entries.map((entry) => ({
      id: entry.id,
      createdAt: entry.createdAt.toISOString(),
      terminalId: entry.terminalId,
      terminalName: entry.terminalName,
      orderId: entry.orderId,
      orderNumber: entry.order?.orderNumber || null,
      amount: Number(entry.amount),
      idempotencyKey: entry.idempotencyKey,
      status: entry.status,
      cardLast4: entry.cardLast4,
      statusNote: entry.statusNote,
    }))

    // Calculate summary statistics
    const allEntries = await db.syncAuditEntry.findMany({
      where: {
        locationId,
        deletedAt: null,
        ...dateFilter,
      },
      select: {
        status: true,
        amount: true,
      },
    })

    const summary = {
      totalCount: allEntries.length,
      successCount: allEntries.filter((e) => e.status === 'SUCCESS').length,
      blockedCount: allEntries.filter((e) => e.status === 'DUPLICATE_BLOCKED').length,
      offlineCount: allEntries.filter((e) => e.status === 'OFFLINE_SYNC').length,
      voidedCount: allEntries.filter((e) => e.status === 'VOIDED').length,
      failedCount: allEntries.filter((e) => e.status === 'FAILED').length,
      totalAmount: allEntries.reduce((sum, e) => sum + Number(e.amount), 0),
      blockedAmount: allEntries
        .filter((e) => e.status === 'DUPLICATE_BLOCKED')
        .reduce((sum, e) => sum + Number(e.amount), 0),
    }

    return NextResponse.json({ data: { logs, summary } })
  } catch (error) {
    console.error('Failed to fetch sync audit logs:', error)
    return NextResponse.json(
      { error: 'Failed to fetch sync audit logs' },
      { status: 500 }
    )
  }
})

/**
 * POST /api/admin/sync-audit
 *
 * Creates a sync audit entry. Used by the sync-resolution endpoint.
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    // Auth check — require API key or admin permission
    const apiKey = request.headers.get('x-api-key')
    const hasApiKey = apiKey && apiKey === process.env.PROVISION_API_KEY

    const body = await request.json()
    const {
      locationId,
      orderId,
      paymentId,
      terminalId,
      terminalName,
      employeeId,
      amount,
      idempotencyKey,
      localIntentId,
      status,
      statusNote,
      cardLast4,
    } = body

    // Auth check — require API key or admin permission
    if (!hasApiKey) {
      const auth = await requirePermission(employeeId, locationId, PERMISSIONS.ADMIN)
      if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Validate required fields
    if (!locationId || !orderId || !terminalId || !idempotencyKey || !status) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const entry = await db.syncAuditEntry.create({
      data: {
        locationId,
        orderId,
        paymentId: paymentId || null,
        terminalId,
        terminalName: terminalName || terminalId,
        employeeId: employeeId || null,
        amount: amount || 0,
        idempotencyKey,
        localIntentId: localIntentId || null,
        status,
        statusNote: statusNote || null,
        cardLast4: cardLast4 || null,
      },
    })

    return NextResponse.json({ data: { success: true, entry } })
  } catch (error) {
    console.error('Failed to create sync audit entry:', error)
    return NextResponse.json(
      { error: 'Failed to create sync audit entry' },
      { status: 500 }
    )
  }
})
