/**
 * Tip Group Template Domain Logic
 *
 * Admin-defined templates (e.g., "Bar Team", "Downstairs Servers") determine
 * which tip groups are available at clock-in. When an employee selects a
 * template, the system finds or creates a runtime TipGroup for that template
 * and adds the employee as a member.
 *
 * Templates enforce the single-group invariant: an employee can only be in
 * one active group at a time.
 */

import { db } from '@/lib/db'
import {
  addMemberToGroup,
  findActiveGroupForEmployee,
} from '@/lib/domain/tips/tip-groups'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EligibleTemplate {
  id: string
  name: string
  defaultSplitMode: string
  allowedRoleIds: string[]
}

export interface TemplateGroupInfo {
  id: string
  status: string
  splitMode: string
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Get templates that the given role is eligible for at a location.
 *
 * Queries active, non-deleted TipGroupTemplates and filters by
 * whether the role ID is in the template's allowedRoleIds JSON array.
 *
 * @param locationId - The location to query templates for
 * @param roleId - The employee's role ID to filter by
 * @returns Array of eligible templates
 */
export async function getEligibleTemplates(
  locationId: string,
  roleId: string
): Promise<EligibleTemplate[]> {
  const templates = await db.tipGroupTemplate.findMany({
    where: {
      locationId,
      active: true,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      defaultSplitMode: true,
      allowedRoleIds: true,
    },
    orderBy: { sortOrder: 'asc' },
  })

  // Filter by roleId presence in allowedRoleIds JSON array
  return templates
    .filter((t) => {
      const roleIds = t.allowedRoleIds as string[]
      return Array.isArray(roleIds) && roleIds.includes(roleId)
    })
    .map((t) => ({
      id: t.id,
      name: t.name,
      defaultSplitMode: t.defaultSplitMode,
      allowedRoleIds: t.allowedRoleIds as string[],
    }))
}

/**
 * Get or create a runtime TipGroup for the given template.
 *
 * If an active group already exists for this template, returns it.
 * Otherwise, creates a new TipGroup linked to the template with
 * the template's default split mode.
 *
 * @param templateId - The template to find/create a group for
 * @param locationId - The location ID
 * @returns The active group info (id, status, splitMode)
 */
export async function getOrCreateGroupForTemplate(
  templateId: string,
  locationId: string
): Promise<TemplateGroupInfo> {
  // Look for an existing active group linked to this template
  const existingGroup = await db.tipGroup.findFirst({
    where: {
      templateId,
      status: 'active',
      deletedAt: null,
    },
    select: {
      id: true,
      status: true,
      splitMode: true,
    },
  })

  if (existingGroup) {
    return {
      id: existingGroup.id,
      status: existingGroup.status,
      splitMode: existingGroup.splitMode,
    }
  }

  // No active group exists — look up template for defaultSplitMode
  const template = await db.tipGroupTemplate.findFirst({
    where: { id: templateId, deletedAt: null },
    select: { defaultSplitMode: true },
  })

  const splitMode = template?.defaultSplitMode ?? 'equal'

  // Create a new group linked to this template
  const newGroup = await db.tipGroup.create({
    data: {
      locationId,
      createdBy: 'system',
      ownerId: 'system',
      templateId,
      status: 'active',
      splitMode,
    },
    select: {
      id: true,
      status: true,
      splitMode: true,
    },
  })

  return {
    id: newGroup.id,
    status: newGroup.status,
    splitMode: newGroup.splitMode,
  }
}

/**
 * Assign an employee to the runtime group for a template.
 *
 * Enforces the single-group invariant: if the employee is already in any
 * active group, throws 'EMPLOYEE_ALREADY_IN_GROUP'.
 *
 * If the template's runtime group has no members yet, uses startTipGroup
 * to create the first membership + segment. Otherwise, uses addMemberToGroup
 * to append the employee and recalculate splits.
 *
 * @param params.employeeId - The employee being assigned
 * @param params.templateId - The template to assign them to
 * @param params.locationId - The location ID
 * @returns The group info (id, status, splitMode)
 * @throws {'EMPLOYEE_ALREADY_IN_GROUP'} if employee is already in an active group
 */
export async function assignEmployeeToTemplateGroup(params: {
  employeeId: string
  templateId: string
  locationId: string
}): Promise<TemplateGroupInfo> {
  const { employeeId, templateId, locationId } = params

  // Enforce single-group invariant: check if employee is already in any active group
  const existingGroup = await findActiveGroupForEmployee(employeeId)
  if (existingGroup) {
    throw new Error('EMPLOYEE_ALREADY_IN_GROUP')
  }

  // Get or create the runtime group for this template
  const group = await getOrCreateGroupForTemplate(templateId, locationId)

  // Check if the group already has active members
  const activeMemberCount = await db.tipGroupMembership.count({
    where: {
      groupId: group.id,
      status: 'active',
      deletedAt: null,
    },
  })

  if (activeMemberCount === 0) {
    // No members yet — create the first membership + segment directly.
    // (startTipGroup creates a new group, but ours already exists.)
    await db.$transaction(async (tx) => {
      await tx.tipGroupMembership.create({
        data: {
          locationId,
          groupId: group.id,
          employeeId,
          joinedAt: new Date(),
          status: 'active',
        },
      })

      // Create initial segment with single member (100% split)
      await tx.tipGroupSegment.create({
        data: {
          locationId,
          groupId: group.id,
          startedAt: new Date(),
          memberCount: 1,
          splitJson: { [employeeId]: 1.0 },
        },
      })
    })
  } else {
    // Group already has members — use addMemberToGroup to append + recalculate
    await addMemberToGroup({
      groupId: group.id,
      employeeId,
      approvedBy: 'system',
    })
  }

  return {
    id: group.id,
    status: group.status,
    splitMode: group.splitMode,
  }
}
