import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

/**
 * Resolve allowed reasons/discounts for an employee.
 *
 * Logic:
 * 1. Get employee's role name
 * 2. Get role-level "allow" rules for that role name
 * 3. Add employee-level "allow" rules
 * 4. Subtract employee-level "deny" rules
 * 5. If NO role rules exist at all for this reasonType, return ALL active reasons (backward compat)
 */
export async function resolveAllowedReasonIds(
  locationId: string,
  employeeId: string,
  reasonType: 'void_reason' | 'comp_reason' | 'discount'
): Promise<{ ids: string[]; hasRules: boolean }> {
  // Get employee's role name
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { roleId: true, role: { select: { name: true } } },
  })

  if (!employee) {
    return { ids: [], hasRules: false }
  }

  const roleName = employee.role.name.toLowerCase()

  // Get all access rules for this location + reasonType
  const allRules = await db.reasonAccess.findMany({
    where: { locationId, reasonType },
  })

  // If no rules exist at all for this reasonType, return empty with hasRules=false
  // (caller should return all active reasons for backward compat)
  if (allRules.length === 0) {
    return { ids: [], hasRules: false }
  }

  // Role-level allows (matched by role name, case-insensitive)
  const roleAllows = new Set(
    allRules
      .filter(r => r.subjectType === 'role' && r.subjectId.toLowerCase() === roleName && r.accessType === 'allow')
      .map(r => r.reasonId)
  )

  // Employee-level allows
  const empAllows = new Set(
    allRules
      .filter(r => r.subjectType === 'employee' && r.subjectId === employeeId && r.accessType === 'allow')
      .map(r => r.reasonId)
  )

  // Employee-level denies
  const empDenies = new Set(
    allRules
      .filter(r => r.subjectType === 'employee' && r.subjectId === employeeId && r.accessType === 'deny')
      .map(r => r.reasonId)
  )

  // Merge: role allows + employee allows - employee denies
  const merged = new Set([...roleAllows, ...empAllows])
  for (const id of empDenies) {
    merged.delete(id)
  }

  return { ids: Array.from(merged), hasRules: true }
}

// GET ?employeeId=X&reasonType=void_reason|comp_reason|discount
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')
    const reasonType = searchParams.get('reasonType') as 'void_reason' | 'comp_reason' | 'discount' | null

    if (!locationId || !employeeId || !reasonType) {
      return NextResponse.json({
        error: 'locationId, employeeId, and reasonType are required',
      }, { status: 400 })
    }

    if (!['void_reason', 'comp_reason', 'discount'].includes(reasonType)) {
      return NextResponse.json({ error: 'reasonType must be "void_reason", "comp_reason", or "discount"' }, { status: 400 })
    }

    const { ids, hasRules } = await resolveAllowedReasonIds(locationId, employeeId, reasonType)

    // If no rules configured, return ALL active reasons (backward compat)
    if (!hasRules) {
      if (reasonType === 'void_reason') {
        const all = await db.voidReason.findMany({
          where: { locationId, isActive: true, deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        })
        return NextResponse.json({ data: { reasons: all, filtered: false } })
      } else if (reasonType === 'comp_reason') {
        const all = await db.compReason.findMany({
          where: { locationId, isActive: true, deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        })
        return NextResponse.json({ data: { reasons: all, filtered: false } })
      } else {
        const all = await db.discountRule.findMany({
          where: { locationId, isActive: true },
          orderBy: [{ priority: 'desc' }, { name: 'asc' }],
        })
        return NextResponse.json({ data: { reasons: all, filtered: false } })
      }
    }

    // Return the actual reason objects for the allowed IDs
    if (reasonType === 'void_reason') {
      const reasons = await db.voidReason.findMany({
        where: { id: { in: ids }, isActive: true, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      })
      return NextResponse.json({ data: { reasons, filtered: true } })
    } else if (reasonType === 'comp_reason') {
      const reasons = await db.compReason.findMany({
        where: { id: { in: ids }, isActive: true, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      })
      return NextResponse.json({ data: { reasons, filtered: true } })
    } else {
      const reasons = await db.discountRule.findMany({
        where: { id: { in: ids }, isActive: true },
        orderBy: [{ priority: 'desc' }, { name: 'asc' }],
      })
      return NextResponse.json({ data: { reasons, filtered: true } })
    }
  } catch (error) {
    console.error('Allowed reasons error:', error)
    return NextResponse.json({ error: 'Failed to fetch allowed reasons' }, { status: 500 })
  }
})
