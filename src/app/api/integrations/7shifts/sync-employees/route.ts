import { NextRequest } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { getCompanyUsers } from '@/lib/7shifts-client'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { db } from '@/lib/db'
import { EmployeeRepository } from '@/lib/repositories'
import { err, notFound, ok } from '@/lib/api-response'

/**
 * POST /api/integrations/7shifts/sync-employees
 *
 * Pull employees FROM 7shifts and sync into POS.
 * Guards:
 *   a. Skip employees with no role assigned in 7shifts (log warning)
 *   b. Create employees without PIN as inactive (needs PIN assignment)
 *   c. Deactivate employees that are inactive in 7shifts
 *
 * Returns: { synced, skipped, deactivated, reasons }
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  const location = await db.location.findFirst({
    where: { deletedAt: null },
    select: { id: true, timezone: true, settings: true },
  })
  if (!location) return notFound('No location')

  const body = await request.json().catch(() => ({})) as { employeeId?: string }
  const actor = await getActorFromRequest(request)
  const resolvedEmployeeId = actor.employeeId ?? body.employeeId
  const auth = await requirePermission(resolvedEmployeeId, location.id, PERMISSIONS.SETTINGS_INTEGRATIONS)
  if (!auth.authorized) {
    return err(auth.error, auth.status)
  }

  const settings = parseSettings(await getLocationSettings(location.id))
  const s = settings.sevenShifts
  if (!s?.enabled || !s.clientId || !s.companyId) {
    return err('7shifts not configured')
  }

  let users
  try {
    users = await getCompanyUsers(s, location.id)
  } catch (caughtErr) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return err(`Failed to fetch 7shifts users: ${msg}`, 502)
  }

  let synced = 0
  let skipped = 0
  let deactivated = 0
  const reasons: string[] = []

  // Get default role for employees that need one
  const defaultRole = await db.role.findFirst({
    where: { locationId: location.id, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })

  if (!defaultRole) {
    return err('No roles configured in POS — cannot sync employees')
  }

  for (const user of users) {
    const fullName = `${user.first_name} ${user.last_name}`.trim()

    // Guard (a): Skip employees with no role assigned in 7shifts
    if (!user.role_ids || user.role_ids.length === 0) {
      console.warn(`[7shifts/sync-employees] Skipping ${fullName} (7shifts ID: ${user.id}) — no role assigned`)
      reasons.push(`Skipped: ${fullName} — no role assigned in 7shifts`)
      skipped++
      continue
    }

    // Check if employee already exists (linked by sevenShiftsUserId)
    const existing = await db.employee.findFirst({
      where: {
        locationId: location.id,
        sevenShiftsUserId: String(user.id),
      },
      select: { id: true, isActive: true, deletedAt: true },
    })

    // Guard (c): Deactivate employees that are inactive in 7shifts
    if (!user.is_active) {
      if (existing && existing.isActive && !existing.deletedAt) {
        await EmployeeRepository.deactivateEmployee(existing.id, location.id)
        reasons.push(`Deactivated: ${fullName} — inactive in 7shifts`)
        deactivated++
      } else if (!existing) {
        // Inactive in 7shifts and doesn't exist in POS — skip entirely
        reasons.push(`Skipped: ${fullName} — inactive in 7shifts, not in POS`)
        skipped++
      }
      continue
    }

    if (existing) {
      // Already linked — reactivate if previously deactivated
      if (!existing.isActive || existing.deletedAt) {
        await EmployeeRepository.updateEmployee(existing.id, location.id, { isActive: true, deletedAt: null })
        reasons.push(`Reactivated: ${fullName}`)
      }
      synced++
      continue
    }

    // Guard (b): Create employee without PIN as inactive
    // New employee from 7shifts — create in POS
    // They need a PIN assignment before they can use the system
    await EmployeeRepository.createEmployee(location.id, {
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email || null,
      pin: '0000', // Placeholder — must be changed
      requiresPinChange: true,
      roleId: defaultRole.id,
      isActive: false, // Inactive until PIN is assigned
      sevenShiftsUserId: String(user.id),
      sevenShiftsRoleId: user.role_ids[0] ? String(user.role_ids[0]) : null,
      sevenShiftsDepartmentId: user.department_ids?.[0] ? String(user.department_ids[0]) : null,
    })

    reasons.push(`Created (inactive): ${fullName} — needs PIN assignment`)
    synced++
  }

  return ok({
      synced,
      skipped,
      deactivated,
      reasons,
    })
})
