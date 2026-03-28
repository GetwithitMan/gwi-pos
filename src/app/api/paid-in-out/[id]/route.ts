import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

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
      return err('Location ID is required')
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.MGR_PAY_IN_OUT)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
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
      return notFound('Record not found')
    }

    return ok({
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
      })
  } catch (error) {
    console.error('Failed to fetch paid in/out record:', error)
    return err('Failed to fetch paid in/out record', 500)
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
      return err('Location ID is required')
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.MGR_PAY_IN_OUT)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    const record = await db.paidInOut.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!record) {
      return notFound('Record not found')
    }

    await db.paidInOut.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    pushUpstream()

    return ok({ success: true })
  } catch (error) {
    console.error('Failed to delete paid in/out record:', error)
    return err('Failed to delete paid in/out record', 500)
  }
})
