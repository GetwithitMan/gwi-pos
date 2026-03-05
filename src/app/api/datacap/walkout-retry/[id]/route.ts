import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { logger } from '@/lib/logger'

// PUT - Write off a walkout retry (mark as unrecoverable)
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    let body: { action?: string; employeeId?: string; locationId?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 })
    }

    if (body.action !== 'write-off') {
      return NextResponse.json({ error: 'Invalid action. Expected "write-off"' }, { status: 400 })
    }

    const { employeeId, locationId } = body

    if (!locationId) {
      return NextResponse.json({ error: 'Missing locationId' }, { status: 400 })
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.MGR_VOID_PAYMENTS)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status ?? 403 })
    }

    // Find the retry record
    const retry = await db.walkoutRetry.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!retry) {
      return NextResponse.json({ error: 'Walkout retry not found' }, { status: 404 })
    }

    if (retry.writtenOffAt) {
      return NextResponse.json({ error: 'Already written off' }, { status: 409 })
    }

    if (retry.status === 'collected') {
      return NextResponse.json({ error: 'Cannot write off a collected retry' }, { status: 409 })
    }

    const updated = await db.walkoutRetry.update({
      where: { id },
      data: {
        writtenOffAt: new Date(),
        writtenOffBy: employeeId || null,
        status: 'written_off',
      },
    })

    return NextResponse.json({ data: updated })
  } catch (error) {
    logger.error('datacap', 'Failed to write off walkout retry', error)
    return NextResponse.json({ error: 'Failed to write off walkout retry' }, { status: 500 })
  }
})
