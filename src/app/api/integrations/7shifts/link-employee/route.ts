import { NextRequest } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { db } from '@/lib/db'
import { err, notFound, ok } from '@/lib/api-response'

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
  if (!location) return notFound('No location')

  const body = await request.json().catch(() => ({})) as Partial<LinkBody>
  if (!body.employeeId || !body.adminEmployeeId) {
    return err('employeeId and adminEmployeeId are required')
  }

  const actor = await getActorFromRequest(request)
  const resolvedEmployeeId = actor.employeeId ?? body.adminEmployeeId
  const auth = await requirePermission(resolvedEmployeeId, location.id, PERMISSIONS.SETTINGS_INTEGRATIONS)
  if (!auth.authorized) {
    return err(auth.error, auth.status)
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

  return ok({ success: true })
})
