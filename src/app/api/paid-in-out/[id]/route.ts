import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

// GET /api/paid-in-out/[id] — get a single paid in/out record
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.MGR_PAY_IN_OUT)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const record = await db.paidInOut.findFirst({
      where: { id, locationId, deletedAt: null },
      include: {
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
        approver: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
        drawer: {
          select: { id: true, name: true },
        },
      },
    })

    if (!record) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 })
    }

    return NextResponse.json({
      data: {
        id: record.id,
        type: record.type === 'in' ? 'paid_in' : 'paid_out',
        amount: Number(record.amount),
        reason: record.reason,
        reference: record.reference,
        employeeId: record.employeeId,
        employeeName: record.employee.displayName || `${record.employee.firstName} ${record.employee.lastName}`,
        approvedBy: record.approvedBy,
        approverName: record.approver
          ? record.approver.displayName || `${record.approver.firstName} ${record.approver.lastName}`
          : null,
        drawerId: record.drawerId,
        drawerName: record.drawer.name,
        createdAt: record.createdAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to fetch paid in/out record:', error)
    return NextResponse.json({ error: 'Failed to fetch paid in/out record' }, { status: 500 })
  }
})

// DELETE /api/paid-in-out/[id] — soft delete a paid in/out record (manager only)
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.MGR_PAY_IN_OUT)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const record = await db.paidInOut.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!record) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 })
    }

    await db.paidInOut.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    pushUpstream()

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete paid in/out record:', error)
    return NextResponse.json({ error: 'Failed to delete paid in/out record' }, { status: 500 })
  }
})
