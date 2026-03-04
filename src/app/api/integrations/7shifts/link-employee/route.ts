import { NextRequest, NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { db } from '@/lib/db'

interface LinkBody {
  employeeId: string
  sevenShiftsUserId: string | null
  sevenShiftsRoleId?: string | null
  sevenShiftsDepartmentId?: string | null
  sevenShiftsLocationId?: string | null
  adminEmployeeId: string
}

export const POST = withVenue(async function POST(request: NextRequest) {
  const location = await db.location.findFirst({ select: { id: true } })
  if (!location) return NextResponse.json({ error: 'No location' }, { status: 404 })

  const body = await request.json().catch(() => ({})) as Partial<LinkBody>
  if (!body.employeeId || !body.adminEmployeeId) {
    return NextResponse.json({ error: 'employeeId and adminEmployeeId are required' }, { status: 400 })
  }

  const auth = await requirePermission(body.adminEmployeeId, location.id, PERMISSIONS.SETTINGS_INTEGRATIONS)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // Unlink: null clears all fields
  const isUnlink = body.sevenShiftsUserId === null

  await db.employee.update({
    where: { id: body.employeeId },
    data: {
      sevenShiftsUserId: isUnlink ? null : (body.sevenShiftsUserId ?? null),
      sevenShiftsRoleId: isUnlink ? null : (body.sevenShiftsRoleId ?? null),
      sevenShiftsDepartmentId: isUnlink ? null : (body.sevenShiftsDepartmentId ?? null),
      sevenShiftsLocationId: isUnlink ? null : (body.sevenShiftsLocationId ?? null),
    },
  })

  return NextResponse.json({ data: { success: true } })
})
