/**
 * Group Service - L4 Table Groups
 *
 * Manages physical merges and virtual combines.
 *
 * Note: The schema uses:
 * - VirtualGroup model for virtual groups
 * - Table.virtualGroupId, virtualGroupPrimary, virtualGroupColor for membership
 * - Table.combinedWithId, combinedTableIds for physical combines (no separate model)
 */

import { db } from '@/shared'
import type { TableGroup, GroupColor } from '../types'
import { GROUP_COLORS } from '../index'

/**
 * Get all virtual groups for a location
 */
export async function getGroupsForLocation(locationId: string): Promise<TableGroup[]> {
  // Get virtual groups from VirtualGroup model
  const virtualGroups = await db.virtualGroup.findMany({
    where: {
      locationId,
      deletedAt: null,
    },
  })

  // For each group, get the tables
  const groups: TableGroup[] = []

  for (const vg of virtualGroups) {
    const tables = await db.table.findMany({
      where: {
        virtualGroupId: vg.id,
        deletedAt: null,
      },
      select: { id: true, virtualGroupPrimary: true, virtualGroupColor: true },
    })

    groups.push({
      id: vg.id,
      locationId: vg.locationId,
      name: vg.name,
      color: (tables[0]?.virtualGroupColor || 'blue') as GroupColor,
      isVirtual: true,
      tableIds: tables.map(t => t.id),
      primaryTableId: tables.find(t => t.virtualGroupPrimary)?.id || vg.primaryTableId,
      createdAt: vg.createdAt,
      createdBy: '', // Not stored in schema
    })
  }

  // Also get physical combines (tables with combinedTableIds)
  // Note: combinedTableIds is a JSON field, so we filter in code
  const allTables = await db.table.findMany({
    where: {
      locationId,
      deletedAt: null,
    },
  })

  const primaryTables = allTables.filter(t => {
    const ids = t.combinedTableIds as string[] | null
    return ids && ids.length > 0
  })

  for (const pt of primaryTables) {
    const combinedIds = (pt.combinedTableIds as string[]) || []
    groups.push({
      id: `physical-${pt.id}`,
      locationId,
      name: pt.name,
      color: 'blue' as GroupColor,
      isVirtual: false,
      tableIds: [pt.id, ...combinedIds],
      primaryTableId: pt.id,
      createdAt: pt.createdAt,
      createdBy: '',
    })
  }

  return groups
}

/**
 * Get a group by ID
 */
export async function getGroupById(groupId: string): Promise<TableGroup | null> {
  // Check if it's a physical group ID
  if (groupId.startsWith('physical-')) {
    const tableId = groupId.replace('physical-', '')
    const table = await db.table.findUnique({
      where: { id: tableId },
    })
    if (!table || !table.combinedTableIds) return null

    const combinedIds = (table.combinedTableIds as string[]) || []
    return {
      id: groupId,
      locationId: table.locationId,
      name: table.name,
      color: 'blue' as GroupColor,
      isVirtual: false,
      tableIds: [table.id, ...combinedIds],
      primaryTableId: table.id,
      createdAt: table.createdAt,
      createdBy: '',
    }
  }

  // Virtual group
  const group = await db.virtualGroup.findUnique({
    where: { id: groupId },
  })

  if (!group) return null

  const tables = await db.table.findMany({
    where: {
      virtualGroupId: group.id,
      deletedAt: null,
    },
    select: { id: true, virtualGroupPrimary: true, virtualGroupColor: true },
  })

  return {
    id: group.id,
    locationId: group.locationId,
    name: group.name,
    color: (tables[0]?.virtualGroupColor || 'blue') as GroupColor,
    isVirtual: true,
    tableIds: tables.map(t => t.id),
    primaryTableId: tables.find(t => t.virtualGroupPrimary)?.id || group.primaryTableId,
    createdAt: group.createdAt,
    createdBy: '',
  }
}

/**
 * Create a virtual group (order-linked, no geometry change)
 */
export async function createVirtualGroup(
  locationId: string,
  tableIds: string[],
  _createdBy: string,
  color?: GroupColor
): Promise<TableGroup> {
  if (tableIds.length < 2) {
    throw new Error('Need at least 2 tables to create a group')
  }

  const selectedColor = color || (await getNextAvailableColor(locationId))
  const primaryTableId = tableIds[0]

  // Get table names for group name
  const tables = await db.table.findMany({
    where: { id: { in: tableIds } },
    select: { name: true },
  })
  const groupName = tables.map(t => t.name).join('+')

  // Create the virtual group
  const group = await db.virtualGroup.create({
    data: {
      locationId,
      name: groupName,
      primaryTableId,
    },
  })

  // Update all tables with virtual group info
  await Promise.all(
    tableIds.map((tableId, index) =>
      db.table.update({
        where: { id: tableId },
        data: {
          virtualGroupId: group.id,
          virtualGroupColor: selectedColor,
          virtualGroupPrimary: index === 0,
          virtualGroupCreatedAt: new Date(),
        },
      })
    )
  )

  return {
    id: group.id,
    locationId,
    name: groupName,
    color: selectedColor,
    isVirtual: true,
    tableIds,
    primaryTableId,
    createdAt: group.createdAt,
    createdBy: _createdBy,
  }
}

/**
 * Create a physical group (magnetic snap, geometry merges)
 * Physical groups don't use a separate model - just table fields
 */
export async function createPhysicalGroup(
  locationId: string,
  primaryTableId: string,
  secondaryTableIds: string[],
  _createdBy: string
): Promise<TableGroup> {
  // Update primary table with combined IDs
  const primaryTable = await db.table.update({
    where: { id: primaryTableId },
    data: {
      combinedTableIds: secondaryTableIds,
    },
  })

  // Update secondary tables to point to primary
  await db.table.updateMany({
    where: { id: { in: secondaryTableIds } },
    data: {
      combinedWithId: primaryTableId,
    },
  })

  return {
    id: `physical-${primaryTableId}`,
    locationId,
    name: primaryTable.name,
    color: 'blue' as GroupColor,
    isVirtual: false,
    tableIds: [primaryTableId, ...secondaryTableIds],
    primaryTableId,
    createdAt: new Date(),
    createdBy: _createdBy,
  }
}

/**
 * Dissolve a group
 */
export async function dissolveGroup(groupId: string): Promise<void> {
  if (groupId.startsWith('physical-')) {
    // Physical group - clear combine fields
    const tableId = groupId.replace('physical-', '')
    const table = await db.table.findUnique({
      where: { id: tableId },
    })

    if (!table) return

    const combinedIds = (table.combinedTableIds as string[]) || []

    // Clear secondary tables
    await db.table.updateMany({
      where: { id: { in: combinedIds } },
      data: {
        combinedWithId: null,
      },
    })

    // Clear primary table
    await db.table.update({
      where: { id: tableId },
      data: {
        combinedTableIds: [],
      },
    })
  } else {
    // Virtual group
    const tables = await db.table.findMany({
      where: { virtualGroupId: groupId },
      select: { id: true },
    })

    // Clear virtual group fields from tables
    await db.table.updateMany({
      where: { id: { in: tables.map(t => t.id) } },
      data: {
        virtualGroupId: null,
        virtualGroupColor: null,
        virtualGroupPrimary: false,
        virtualGroupCreatedAt: null,
      },
    })

    // Soft delete the group
    await db.virtualGroup.update({
      where: { id: groupId },
      data: { deletedAt: new Date() },
    })
  }
}

/**
 * Add a table to an existing virtual group
 */
export async function addTableToGroup(
  groupId: string,
  tableId: string
): Promise<TableGroup> {
  if (groupId.startsWith('physical-')) {
    throw new Error('Cannot add tables to physical groups')
  }

  const group = await db.virtualGroup.findUnique({
    where: { id: groupId },
  })

  if (!group) {
    throw new Error('Group not found')
  }

  // Get existing color from other tables
  const existingTable = await db.table.findFirst({
    where: { virtualGroupId: groupId },
    select: { virtualGroupColor: true },
  })

  await db.table.update({
    where: { id: tableId },
    data: {
      virtualGroupId: groupId,
      virtualGroupColor: existingTable?.virtualGroupColor || 'blue',
      virtualGroupPrimary: false,
    },
  })

  // Update group name
  const tables = await db.table.findMany({
    where: { virtualGroupId: groupId },
    select: { name: true },
  })

  await db.virtualGroup.update({
    where: { id: groupId },
    data: {
      name: tables.map(t => t.name).join('+'),
    },
  })

  return getGroupById(groupId) as Promise<TableGroup>
}

/**
 * Remove a table from a virtual group
 */
export async function removeTableFromGroup(
  groupId: string,
  tableId: string
): Promise<TableGroup | null> {
  if (groupId.startsWith('physical-')) {
    throw new Error('Use dissolveGroup for physical groups')
  }

  const tables = await db.table.findMany({
    where: { virtualGroupId: groupId },
    select: { id: true },
  })

  // If only 2 tables, dissolve the group
  if (tables.length <= 2) {
    await dissolveGroup(groupId)
    return null
  }

  // Clear the table's group fields
  await db.table.update({
    where: { id: tableId },
    data: {
      virtualGroupId: null,
      virtualGroupColor: null,
      virtualGroupPrimary: false,
    },
  })

  // Update group name
  const remainingTables = await db.table.findMany({
    where: { virtualGroupId: groupId },
    select: { name: true },
  })

  await db.virtualGroup.update({
    where: { id: groupId },
    data: {
      name: remainingTables.map(t => t.name).join('+'),
    },
  })

  return getGroupById(groupId)
}

/**
 * Get the next available color for a new group
 */
async function getNextAvailableColor(locationId: string): Promise<GroupColor> {
  const tables = await db.table.findMany({
    where: {
      locationId,
      virtualGroupId: { not: null },
      virtualGroupColor: { not: null },
      deletedAt: null,
    },
    select: { virtualGroupColor: true },
    distinct: ['virtualGroupColor'],
  })

  const usedColors = new Set(tables.map(t => t.virtualGroupColor))

  for (const color of GROUP_COLORS) {
    if (!usedColors.has(color)) {
      return color
    }
  }

  // If all colors used, cycle back to first
  return GROUP_COLORS[0]
}
