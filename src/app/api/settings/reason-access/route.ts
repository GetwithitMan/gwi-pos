import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'

// GET - List reason access rules
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const subjectType = searchParams.get('subjectType') // "role" | "employee"
    const subjectId = searchParams.get('subjectId')
    const reasonType = searchParams.get('reasonType') // "void_reason" | "comp_reason" | "discount"

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const where: Record<string, unknown> = { locationId }

    if (subjectType) where.subjectType = subjectType
    if (subjectId) where.subjectId = subjectId
    if (reasonType) where.reasonType = reasonType

    const rules = await db.reasonAccess.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ data: { rules } })
  } catch (error) {
    console.error('Reason access list error:', error)
    return NextResponse.json({ error: 'Failed to fetch reason access rules' }, { status: 500 })
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
      return NextResponse.json({
        error: 'locationId, subjectType, subjectId, reasonType, and reasonId are required',
      }, { status: 400 })
    }

    // Require settings.security permission — this controls who can void/comp
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? body.employeeId
    const authResult = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.SETTINGS_SECURITY)
    if (!authResult.authorized) return NextResponse.json({ error: authResult.error }, { status: authResult.status })

    if (!['role', 'employee'].includes(subjectType)) {
      return NextResponse.json({ error: 'subjectType must be "role" or "employee"' }, { status: 400 })
    }

    if (!['void_reason', 'comp_reason', 'discount'].includes(reasonType)) {
      return NextResponse.json({ error: 'reasonType must be "void_reason", "comp_reason", or "discount"' }, { status: 400 })
    }

    if (accessType && !['allow', 'deny'].includes(accessType)) {
      return NextResponse.json({ error: 'accessType must be "allow" or "deny"' }, { status: 400 })
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

    return NextResponse.json({ data: { rule } })
  } catch (error) {
    console.error('Create reason access error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'This access rule already exists' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to create reason access rule' }, { status: 500 })
  }
})

// DELETE - Delete reason access rule by id
export const DELETE = withVenue(async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Rule ID required' }, { status: 400 })
    }

    const existing = await db.reasonAccess.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    }

    // Require settings.security permission — this controls who can void/comp
    const actor = await getActorFromRequest(request)
    const authResult = await requirePermission(actor.employeeId, existing.locationId, PERMISSIONS.SETTINGS_SECURITY)
    if (!authResult.authorized) return NextResponse.json({ error: authResult.error }, { status: authResult.status })

    // Hard delete: ReasonAccess has no deletedAt column
    await db.reasonAccess.delete({ where: { id } })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Delete reason access error:', error)
    return NextResponse.json({ error: 'Failed to delete reason access rule' }, { status: 500 })
  }
})
