import { db } from '@/lib/db'
import { EmployeeRepository } from '@/lib/repositories'

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
  const employee = await EmployeeRepository.getEmployeeByIdWithInclude(employeeId, locationId, {
    role: { select: { name: true } },
  })

  if (!employee) {
    return { ids: [], hasRules: false }
  }

  const roleName = employee.role.name.toLowerCase()

  const allRules = await db.reasonAccess.findMany({
    where: { locationId, reasonType },
  })

  if (allRules.length === 0) {
    return { ids: [], hasRules: false }
  }

  const roleAllows = new Set(
    allRules
      .filter(r => r.subjectType === 'role' && r.subjectId.toLowerCase() === roleName && r.accessType === 'allow')
      .map(r => r.reasonId)
  )

  const empAllows = new Set(
    allRules
      .filter(r => r.subjectType === 'employee' && r.subjectId === employeeId && r.accessType === 'allow')
      .map(r => r.reasonId)
  )

  const empDenies = new Set(
    allRules
      .filter(r => r.subjectType === 'employee' && r.subjectId === employeeId && r.accessType === 'deny')
      .map(r => r.reasonId)
  )

  const merged = new Set([...roleAllows, ...empAllows])
  for (const id of empDenies) {
    merged.delete(id)
  }

  return { ids: Array.from(merged), hasRules: true }
}
