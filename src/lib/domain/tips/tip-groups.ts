/**
 * Tip Group Domain Logic (Skill 252)
 *
 * Dynamic tip groups allow employees to pool tips during a shift. When the group
 * membership changes (join/leave), a new "segment" is created so that split
 * percentages are tracked over time. This enables fair pro-rata allocation even
 * when bartenders clock in/out at different times.
 *
 * Allocation of actual tip dollars to ledger entries is handled by tip-allocation.ts.
 * This module is strictly about group lifecycle and segment management.
 *
 * TODO: Migrate to repositories once TipGroup/TipGroupMembership/TipGroupSegment
 * repos are created. The tx.employee.findMany in createSegment could use
 * EmployeeRepository but is inside $transaction blocks that pass tx directly.
 */

import { db } from '@/lib/db'
import { createChildLogger } from '@/lib/logger'
import { TipGroupSplitMode, TipGroupStatus, TipGroupMembershipStatus } from '@/generated/prisma/client'

const log = createChildLogger('tips')

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TipGroupInfo {
  id: string
  locationId: string
  createdBy: string
  ownerId: string
  registerId: string | null
  startedAt: Date
  endedAt: Date | null
  status: string
  splitMode: string
  members: TipGroupMemberInfo[]
  currentSegment: TipGroupSegmentInfo | null
}

export interface TipGroupMemberInfo {
  id: string
  employeeId: string
  firstName: string
  lastName: string
  displayName: string | null
  joinedAt: Date
  leftAt: Date | null
  status: string
  role: string | null
}

export interface TipGroupSegmentInfo {
  id: string
  startedAt: Date
  endedAt: Date | null
  memberCount: number
  splitJson: Record<string, number>
}

// ─── Internal Types ──────────────────────────────────────────────────────────

/** Prisma interactive transaction client (subset of PrismaClient used inside $transaction) */
type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0]

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Build an equal-split JSON object from a list of member employee IDs.
 * Each member's split = 1 / memberCount. The last member absorbs any
 * rounding remainder so the shares always sum to exactly 1.0.
 *
 * Example: 3 members => { "a": 0.3333, "b": 0.3333, "c": 0.3334 }
 */
function buildEqualSplitJson(memberIds: string[]): Record<string, number> {
  const splitJson: Record<string, number> = {}
  const count = memberIds.length
  if (count === 0) return splitJson

  // Skill 275: sort for deterministic remainder allocation
  const sorted = [...memberIds].sort()
  const perMember = Math.floor((1 / count) * 10000) / 10000
  let allocated = 0
  for (let i = 0; i < count; i++) {
    if (i === count - 1) {
      splitJson[sorted[i]] = Math.round((1 - allocated) * 10000) / 10000
    } else {
      splitJson[sorted[i]] = perMember
      allocated += perMember
    }
  }
  return splitJson
}

/**
 * Validate that a custom splits map sums to ~1.0 (within 0.01 tolerance)
 * and that all values are positive decimals.
 *
 * @throws Error if validation fails
 */
function validateCustomSplits(
  customSplits: Record<string, number>,
  memberIds: string[]
): void {
  const splitKeys = Object.keys(customSplits)

  // Every active member must have a split entry
  const missingMembers = memberIds.filter(id => !(id in customSplits))
  if (missingMembers.length > 0) {
    throw new Error(
      `Custom splits missing entries for members: ${missingMembers.join(', ')}`
    )
  }

  // No extra entries beyond active members
  const extraKeys = splitKeys.filter(k => !memberIds.includes(k))
  if (extraKeys.length > 0) {
    throw new Error(
      `Custom splits contain unknown employee IDs: ${extraKeys.join(', ')}`
    )
  }

  // All values must be positive
  for (const [empId, value] of Object.entries(customSplits)) {
    if (typeof value !== 'number' || value < 0) {
      throw new Error(
        `Custom split for employee ${empId} must be a non-negative number, got: ${value}`
      )
    }
  }

  // Sum must be ~1.0 (within 0.01 tolerance)
  const sum = Object.values(customSplits).reduce((a, b) => a + b, 0)
  if (Math.abs(sum - 1.0) > 0.01) {
    throw new Error(
      `Custom splits must sum to 1.0 (got ${sum.toFixed(4)})`
    )
  }
}

/**
 * Build a role-weighted split JSON from member employee IDs and their role weights.
 * Each member's share = their weight / total weight of all members.
 * The last member (alphabetically) absorbs rounding remainder.
 *
 * Example: weights [1.5, 1.0, 0.5] => total 3.0 => shares [0.5, 0.3333, 0.1667]
 */
function buildWeightedSplitJson(
  members: Array<{ employeeId: string; weight: number }>
): Record<string, number> {
  const splitJson: Record<string, number> = {}
  if (members.length === 0) return splitJson

  // Sort for deterministic remainder allocation (Skill 275)
  const sorted = [...members].sort((a, b) => a.employeeId.localeCompare(b.employeeId))

  const totalWeight = sorted.reduce((sum, m) => sum + m.weight, 0)
  if (totalWeight <= 0) {
    // Fallback to equal split if all weights are zero
    return buildEqualSplitJson(sorted.map(m => m.employeeId))
  }

  let allocated = 0
  for (let i = 0; i < sorted.length; i++) {
    if (i === sorted.length - 1) {
      // Last member absorbs rounding remainder
      splitJson[sorted[i].employeeId] = Math.round((1 - allocated) * 10000) / 10000
    } else {
      const share = Math.floor((sorted[i].weight / totalWeight) * 10000) / 10000
      splitJson[sorted[i].employeeId] = share
      allocated += share
    }
  }
  return splitJson
}

/**
 * Create a new segment with splits based on active member IDs.
 * When splitMode is 'role_weighted', looks up each member's role tipWeight.
 * Otherwise falls back to equal splits.
 * Uses the transaction client so it can be called inside $transaction blocks.
 */
async function createSegment(
  tx: TxClient,
  groupId: string,
  locationId: string,
  activeMembers: { employeeId: string }[],
  splitMode: string = 'equal',
  customSplits?: Record<string, number>
): Promise<TipGroupSegmentInfo> {
  const now = new Date()
  const memberIds = activeMembers.map((m) => m.employeeId)

  // Guard: empty memberIds would produce an empty splitJson `{}`, causing tips
  // allocated against this segment to be silently lost. This should never happen
  // in normal operation (startTipGroup always includes the creator), but defend
  // against it explicitly.
  if (memberIds.length === 0) {
    throw new Error(
      `[tip-groups] Cannot create segment with zero members for group ${groupId}. ` +
        `This would produce an empty splitJson and cause tip loss.`
    )
  }

  let splitJson: Record<string, number>

  if (splitMode === 'custom') {
    if (!customSplits) {
      throw new Error("Custom splits required when splitMode is 'custom'")
    }
    validateCustomSplits(customSplits, memberIds)
    splitJson = { ...customSplits }
  } else if (splitMode === 'role_weighted' && memberIds.length > 0) {
    // Look up each member's role weight
    const employees = await tx.employee.findMany({
      where: { id: { in: memberIds } },
      select: {
        id: true,
        role: { select: { tipWeight: true } },
      },
    })

    const weightedMembers = employees.map(emp => {
      if (!emp.role?.tipWeight) {
        log.warn({
          employeeId: emp.id,
          groupId,
        }, 'Employee has no role/tipWeight, defaulting to weight=1 (equal split)')
      }
      return {
        employeeId: emp.id,
        weight: Number(emp.role?.tipWeight ?? 1),
      }
    })

    splitJson = buildWeightedSplitJson(weightedMembers)
  } else {
    splitJson = buildEqualSplitJson(memberIds)
  }

  const segment = await tx.tipGroupSegment.create({
    data: {
      locationId,
      groupId,
      startedAt: now,
      memberCount: memberIds.length,
      splitJson,
    },
  })

  return {
    id: segment.id,
    startedAt: segment.startedAt,
    endedAt: segment.endedAt,
    memberCount: segment.memberCount,
    splitJson: segment.splitJson as Record<string, number>,
  }
}

/**
 * Close the current (open-ended) segment for a group by setting its endedAt.
 * Returns the closed segment ID, or null if no open segment exists.
 */
async function closeCurrentSegment(
  groupId: string,
  tx: TxClient,
  overrideEndedAt?: Date
): Promise<string | null> {
  const now = overrideEndedAt ?? new Date()

  const openSegment = await tx.tipGroupSegment.findFirst({
    where: {
      groupId,
      endedAt: null,
      deletedAt: null,
    },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  })

  if (!openSegment) return null

  await tx.tipGroupSegment.update({
    where: { id: openSegment.id },
    data: { endedAt: now },
  })

  return openSegment.id
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Fetch full group info including active members (with employee names)
 * and the current open segment. Returns null if the group does not exist.
 */
export async function getGroupInfo(groupId: string): Promise<TipGroupInfo | null> {
  const group = await db.tipGroup.findFirst({
    where: {
      id: groupId,
      deletedAt: null,
    },
    include: {
      memberships: {
        where: { deletedAt: null },
        include: {
          employee: {
            select: {
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
        },
        orderBy: { joinedAt: 'asc' },
      },
      segments: {
        where: {
          endedAt: null,
          deletedAt: null,
        },
        orderBy: { startedAt: 'desc' },
        take: 1,
      },
    },
  })

  if (!group) return null

  const members: TipGroupMemberInfo[] = group.memberships.map((m) => ({
    id: m.id,
    employeeId: m.employeeId,
    firstName: m.employee.firstName,
    lastName: m.employee.lastName,
    displayName: m.employee.displayName,
    joinedAt: m.joinedAt,
    leftAt: m.leftAt,
    status: m.status,
    role: m.role,
  }))

  const currentSeg = group.segments[0] ?? null
  const currentSegment: TipGroupSegmentInfo | null = currentSeg
    ? {
        id: currentSeg.id,
        startedAt: currentSeg.startedAt,
        endedAt: currentSeg.endedAt,
        memberCount: currentSeg.memberCount,
        splitJson: currentSeg.splitJson as Record<string, number>,
      }
    : null

  return {
    id: group.id,
    locationId: group.locationId,
    createdBy: group.createdBy,
    ownerId: group.ownerId,
    registerId: group.registerId,
    startedAt: group.startedAt,
    endedAt: group.endedAt,
    status: group.status,
    splitMode: group.splitMode,
    members,
    currentSegment,
  }
}

/**
 * Start a new tip group. The creator becomes the owner and is automatically
 * included in the initial members list. A first segment is created with
 * equal splits for all initial members.
 */
export async function startTipGroup(params: {
  locationId: string
  createdBy: string
  registerId?: string
  initialMemberIds: string[]
  splitMode?: string
  customSplits?: Record<string, number>
}): Promise<TipGroupInfo> {
  const { locationId, createdBy, registerId, initialMemberIds, splitMode, customSplits } = params
  const mode = splitMode ?? 'equal'
  const now = new Date()

  // Ensure creator is in the member list
  const allMemberIds = Array.from(new Set([createdBy, ...initialMemberIds]))

  const group = await db.$transaction(async (tx) => {
    // Validate no initial member is already in an active group
    if (allMemberIds.length > 0) {
      const existingActiveMemberships = await tx.tipGroupMembership.findMany({
        where: {
          employeeId: { in: allMemberIds },
          status: 'active',
          deletedAt: null,
          group: { status: 'active', deletedAt: null },
        },
        select: { employeeId: true },
      })
      if (existingActiveMemberships.length > 0) {
        throw new Error('EMPLOYEE_IN_ANOTHER_GROUP')
      }
    }

    // 1. Create the group
    const tipGroup = await tx.tipGroup.create({
      data: {
        locationId,
        createdBy,
        ownerId: createdBy,
        registerId: registerId ?? null,
        startedAt: now,
        status: TipGroupStatus.active,
        splitMode: mode as TipGroupSplitMode,
      },
    })

    // 2. Create memberships for all initial members
    await tx.tipGroupMembership.createMany({
      data: allMemberIds.map((empId) => ({
        locationId,
        groupId: tipGroup.id,
        employeeId: empId,
        joinedAt: now,
        status: TipGroupMembershipStatus.active,
      })),
    })

    // 3. Create first segment with splits based on mode
    await createSegment(
      tx,
      tipGroup.id,
      locationId,
      allMemberIds.map((id) => ({ employeeId: id })),
      mode,
      customSplits
    )

    return tipGroup
  })

  // Return full group info
  const info = await getGroupInfo(group.id)
  return info!
}

/**
 * Add an employee to an active group. Closes the current segment and opens
 * a new one with recalculated splits including the new member.
 *
 * For 'custom' splitMode, the caller must provide updated customSplits
 * that include the new member. For other modes, splits are recalculated automatically.
 *
 * @throws Error if the group is not active or the employee is already a member
 */
export async function addMemberToGroup(params: {
  groupId: string
  employeeId: string
  approvedBy: string
  customSplits?: Record<string, number>
}): Promise<TipGroupInfo> {
  const { groupId, employeeId, approvedBy, customSplits } = params
  const now = new Date()

  await db.$transaction(async (tx) => {
    // Validate group is active
    const group = await tx.tipGroup.findFirst({
      where: { id: groupId, status: 'active', deletedAt: null },
    })
    if (!group) {
      throw new Error('TIP_GROUP_NOT_ACTIVE')
    }

    // Validate employee is not already an active member of THIS group
    const existingMembership = await tx.tipGroupMembership.findFirst({
      where: {
        groupId,
        employeeId,
        status: 'active',
        deletedAt: null,
      },
    })
    if (existingMembership) {
      throw new Error('EMPLOYEE_ALREADY_MEMBER')
    }

    // Validate employee is not in ANY other active group
    const otherActiveMembership = await tx.tipGroupMembership.findFirst({
      where: {
        employeeId,
        status: 'active',
        deletedAt: null,
        group: { status: 'active', deletedAt: null },
        groupId: { not: groupId },
      },
    })
    if (otherActiveMembership) {
      throw new Error('EMPLOYEE_IN_ANOTHER_GROUP')
    }

    // Close current segment
    await closeCurrentSegment(groupId, tx)

    // Create new membership
    await tx.tipGroupMembership.create({
      data: {
        locationId: group.locationId,
        groupId,
        employeeId,
        joinedAt: now,
        status: 'active',
        approvedBy,
      },
    })

    // Get all active members for new segment
    const activeMembers = await tx.tipGroupMembership.findMany({
      where: {
        groupId,
        status: 'active',
        deletedAt: null,
      },
      select: { employeeId: true },
    })

    // Create new segment with recalculated splits
    await createSegment(tx, groupId, group.locationId, activeMembers, group.splitMode, customSplits)
  })

  const info = await getGroupInfo(groupId)
  return info!
}

/**
 * Remove an employee from an active group. Closes the current segment and
 * opens a new one without the removed member. If this was the last member,
 * the group is closed entirely and null is returned.
 *
 * @throws Error if the group is not active or the employee is not an active member
 */
export async function removeMemberFromGroup(params: {
  groupId: string
  employeeId: string
  overrideLeftAt?: Date
}): Promise<TipGroupInfo | null> {
  const { groupId, employeeId, overrideLeftAt } = params
  const now = overrideLeftAt ?? new Date()

  const groupClosed = await db.$transaction(async (tx) => {
    // Validate group is active
    const group = await tx.tipGroup.findFirst({
      where: { id: groupId, status: 'active', deletedAt: null },
    })
    if (!group) {
      throw new Error('TIP_GROUP_NOT_ACTIVE')
    }

    // Validate employee is an active member
    const membership = await tx.tipGroupMembership.findFirst({
      where: {
        groupId,
        employeeId,
        status: 'active',
        deletedAt: null,
      },
    })
    if (!membership) {
      throw new Error('EMPLOYEE_NOT_MEMBER')
    }

    // Mark membership as "left"
    await tx.tipGroupMembership.update({
      where: { id: membership.id },
      data: { status: 'left', leftAt: now },
    })

    // Close current segment (use override time if provided)
    await closeCurrentSegment(groupId, tx, overrideLeftAt)

    // Count remaining active members
    const remainingMembers = await tx.tipGroupMembership.findMany({
      where: {
        groupId,
        status: 'active',
        deletedAt: null,
      },
      select: { employeeId: true },
    })

    if (remainingMembers.length === 0) {
      // Last member removed -- close the group
      await tx.tipGroup.update({
        where: { id: groupId },
        data: { endedAt: now, status: 'closed' },
      })
      return true // group closed
    }

    // Create new segment without the removed member
    await createSegment(tx, groupId, group.locationId, remainingMembers, group.splitMode)

    return false // group still active
  })

  if (groupClosed) return null

  return getGroupInfo(groupId)
}

/**
 * Request to join a tip group. Creates a pending membership that must be
 * approved by the group owner before the employee is added to the active
 * split. No segment change occurs until approval.
 *
 * @throws Error if the group is not active or the employee already has a membership
 */
export async function requestJoinGroup(params: {
  groupId: string
  employeeId: string
}): Promise<{ membershipId: string; status: string }> {
  const { groupId, employeeId } = params

  // Validate group is active
  const group = await db.tipGroup.findFirst({
    where: { id: groupId, status: 'active', deletedAt: null },
  })
  if (!group) {
    throw new Error('TIP_GROUP_NOT_ACTIVE')
  }

  // Validate employee does not already have an active or pending membership
  const existingMembership = await db.tipGroupMembership.findFirst({
    where: {
      groupId,
      employeeId,
      status: { in: ['active', 'pending_approval'] },
      deletedAt: null,
    },
  })
  if (existingMembership) {
    throw new Error('EMPLOYEE_ALREADY_MEMBER_OR_PENDING')
  }

  const membership = await db.tipGroupMembership.create({
    data: {
      locationId: group.locationId,
      groupId,
      employeeId,
      status: 'pending_approval',
    },
  })

  return {
    membershipId: membership.id,
    status: membership.status,
  }
}

/**
 * Approve a pending join request. Activates the membership, closes the current
 * segment, and creates a new segment including the newly approved member.
 *
 * @throws Error if no pending membership is found for this employee
 */
export async function approveJoinRequest(params: {
  groupId: string
  employeeId: string
  approvedBy: string
}): Promise<TipGroupInfo> {
  const { groupId, employeeId, approvedBy } = params
  const now = new Date()

  await db.$transaction(async (tx) => {
    // Find pending membership
    const membership = await tx.tipGroupMembership.findFirst({
      where: {
        groupId,
        employeeId,
        status: 'pending_approval',
        deletedAt: null,
      },
    })
    if (!membership) {
      throw new Error('NO_PENDING_REQUEST')
    }

    // Get group for locationId
    const group = await tx.tipGroup.findFirst({
      where: { id: groupId, status: 'active', deletedAt: null },
    })
    if (!group) {
      throw new Error('TIP_GROUP_NOT_ACTIVE')
    }

    // Validate employee is not in another active group
    const otherActiveMembership = await tx.tipGroupMembership.findFirst({
      where: {
        employeeId,
        status: 'active',
        deletedAt: null,
        group: { status: 'active', deletedAt: null },
        groupId: { not: groupId },
      },
    })
    if (otherActiveMembership) {
      throw new Error('EMPLOYEE_IN_ANOTHER_GROUP')
    }

    // Activate the membership
    await tx.tipGroupMembership.update({
      where: { id: membership.id },
      data: {
        status: 'active',
        approvedBy,
        joinedAt: now,
      },
    })

    // Close current segment
    await closeCurrentSegment(groupId, tx)

    // Get all active members for new segment
    const activeMembers = await tx.tipGroupMembership.findMany({
      where: {
        groupId,
        status: 'active',
        deletedAt: null,
      },
      select: { employeeId: true },
    })

    // Create new segment including approved member
    await createSegment(tx, groupId, group.locationId, activeMembers, group.splitMode)
  })

  const info = await getGroupInfo(groupId)
  return info!
}

/**
 * Transfer group ownership to another active member.
 *
 * @throws Error if the new owner is not an active member
 */
export async function transferGroupOwnership(params: {
  groupId: string
  newOwnerId: string
}): Promise<void> {
  const { groupId, newOwnerId } = params

  // Validate new owner is an active member
  const membership = await db.tipGroupMembership.findFirst({
    where: {
      groupId,
      employeeId: newOwnerId,
      status: 'active',
      deletedAt: null,
    },
  })
  if (!membership) {
    throw new Error('NEW_OWNER_NOT_ACTIVE_MEMBER')
  }

  await db.tipGroup.update({
    where: { id: groupId },
    data: { ownerId: newOwnerId },
  })
}

/**
 * Close a tip group entirely. Sets the group status to 'closed', closes
 * the current segment, and marks all active memberships as 'left'.
 */
export async function closeGroup(groupId: string): Promise<void> {
  const now = new Date()

  await db.$transaction(async (tx) => {
    // Close the group
    await tx.tipGroup.update({
      where: { id: groupId },
      data: { endedAt: now, status: 'closed' },
    })

    // Close current segment
    await closeCurrentSegment(groupId, tx)

    // Mark all active memberships as 'left'
    await tx.tipGroupMembership.updateMany({
      where: {
        groupId,
        status: 'active',
        deletedAt: null,
      },
      data: {
        status: 'left',
        leftAt: now,
      },
    })
  })
}

/**
 * Find the active tip group for a given employee. An employee can only be
 * in one active group at a time. Returns null if the employee is not currently
 * in any active group.
 */
export async function findActiveGroupForEmployee(
  employeeId: string
): Promise<TipGroupInfo | null> {
  const membership = await db.tipGroupMembership.findFirst({
    where: {
      employeeId,
      status: 'active',
      deletedAt: null,
      group: {
        status: 'active',
        deletedAt: null,
      },
    },
    select: { groupId: true },
  })

  if (!membership) return null

  return getGroupInfo(membership.groupId)
}

/**
 * Find the segment that was active at a specific timestamp for a group.
 * A segment is considered active if: startedAt <= timestamp AND
 * (endedAt is null OR endedAt > timestamp).
 *
 * This is used by tip-allocation.ts to determine the split percentages
 * that were in effect when a specific tip was received.
 */
export async function findSegmentForTimestamp(
  groupId: string,
  timestamp: Date,
  txClient?: any
): Promise<TipGroupSegmentInfo | null> {
  const client = txClient ?? db
  const segment = await client.tipGroupSegment.findFirst({
    where: {
      groupId,
      deletedAt: null,
      startedAt: { lte: timestamp },
      OR: [
        { endedAt: null },
        { endedAt: { gt: timestamp } },
      ],
    },
    orderBy: { startedAt: 'desc' },
  })

  if (!segment) return null

  return {
    id: segment.id,
    startedAt: segment.startedAt,
    endedAt: segment.endedAt,
    memberCount: segment.memberCount,
    splitJson: segment.splitJson as Record<string, number>,
  }
}

/**
 * Returns the first active tip group at this location where the given employee
 * is the sole remaining active member, or null if no such group exists.
 *
 * Used by the clock-out API to enforce the last-member group-closeout rule:
 * the final active member cannot clock out until the group is explicitly closed.
 *
 * This is intentionally a simple count check (not a DB constraint) so that
 * concurrent removals remain safe: the worst case is two members both see
 * count=1 simultaneously, both get blocked, and one must resolve first.
 */
export async function findLastMemberGroup(
  employeeId: string,
  locationId: string,
): Promise<{ groupId: string } | null> {
  // Find every active group at this location where the employee is active
  const memberships = await db.tipGroupMembership.findMany({
    where: {
      employeeId,
      status: 'active',
      group: {
        locationId,
        status: 'active',
      },
    },
    select: { groupId: true },
  })

  if (memberships.length === 0) return null

  // For each candidate group, count total active members.
  // An employee can realistically only be in one group at a time,
  // so this loop almost always runs once.
  for (const { groupId } of memberships) {
    const activeMemberCount = await db.tipGroupMembership.count({
      where: {
        groupId,
        status: 'active',
      },
    })
    if (activeMemberCount === 1) {
      return { groupId }
    }
  }

  return null
}
