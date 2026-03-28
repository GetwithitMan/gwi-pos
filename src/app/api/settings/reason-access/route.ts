import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

// GET - List reason access rules
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const subjectType = searchParams.get('subjectType') // "role" | "employee"
    const subjectId = searchParams.get('subjectId')
    const reasonType = searchParams.get('reasonType') // "void_reason" | "comp_reason" | "discount"

    if (!locationId) {
      return err('Location ID required')
    }

    const where: Record<string, unknown> = { locationId }

    if (subjectType) where.subjectType = subjectType
    if (subjectId) where.subjectId = subjectId
    if (reasonType) where.reasonType = reasonType

    const rules = await db.reasonAccess.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })

    return ok({ rules })
  } catch (error) {
    console.error('Reason access list error:', error)
    return err('Failed to fetch reason access rules', 500)
  }
})

// POST - Create reason access rule
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      subjectType,
      subjectId,
      reasonType,
      reasonId,
      accessType,
    } = body

    if (!locationId || !subjectType || !subjectId || !reasonType || !reasonId) {
      return err('locationId, subjectType, subjectId, reasonType, and reasonId are required')
    }

    // Require settings.security permission — this controls who can void/comp
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? body.employeeId
    const authResult = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.SETTINGS_SECURITY)
    if (!authResult.authorized) return err(authResult.error, authResult.status)

    if (!['role', 'employee'].includes(subjectType)) {
      return err('subjectType must be "role" or "employee"')
    }

    if (!['void_reason', 'comp_reason', 'discount'].includes(reasonType)) {
      return err('reasonType must be "void_reason", "comp_reason", or "discount"')
    }

    if (accessType && !['allow', 'deny'].includes(accessType)) {
      return err('accessType must be "allow" or "deny"')
    }

    const rule = await db.reasonAccess.create({
      data: {
        locationId,
        subjectType,
        subjectId,
        reasonType,
        reasonId,
        accessType: accessType || 'allow',
      },
    })
    pushUpstream()

    return ok({ rule })
  } catch (error) {
    console.error('Create reason access error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return err('This access rule already exists')
    }
    return err('Failed to create reason access rule', 500)
  }
})

// DELETE - Delete reason access rule by id
export const DELETE = withVenue(async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return err('Rule ID required')
    }

    const existing = await db.reasonAccess.findUnique({ where: { id } })
    if (!existing) {
      return notFound('Rule not found')
    }

    // Require settings.security permission — this controls who can void/comp
    const actor = await getActorFromRequest(request)
    const authResult = await requirePermission(actor.employeeId, existing.locationId, PERMISSIONS.SETTINGS_SECURITY)
    if (!authResult.authorized) return err(authResult.error, authResult.status)

    // Hard delete: ReasonAccess has no deletedAt column
    await db.reasonAccess.delete({ where: { id } })
    pushUpstream()

    return ok({ success: true })
  } catch (error) {
    console.error('Delete reason access error:', error)
    return err('Failed to delete reason access rule', 500)
  }
})
