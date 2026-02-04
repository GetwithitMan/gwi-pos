/**
 * GWI POS - Floor Plan Domain
 * Layer 4: Table Groups - API Service
 *
 * Central service for managing table groups (physical merge + virtual groups)
 */

import { TableGroup, Seat } from '../shared/types';
import {
  getNextAvailableColor,
  markColorInUse,
  releaseColor,
  clearColorAssignments,
} from './colorPalette';

// In-memory storage for groups (would be replaced with database)
const groups = new Map<string, TableGroup>();

// Track which tables are in groups
const tableToGroupMap = new Map<string, string>();

// Counter for generating group IDs
let groupIdCounter = 1;

/**
 * Table Group API Interface
 */
export interface TableGroupAPI {
  // Create/dissolve
  createPhysicalMerge(tableIds: string[]): TableGroup;
  createVirtualGroup(tableIds: string[]): TableGroup;
  dissolveGroup(groupId: string): void;

  // Queries
  getGroup(groupId: string): TableGroup | null;
  getGroupForTable(tableId: string): TableGroup | null;
  getAllActiveGroups(): TableGroup[];
  getGroupsInRoom(roomId: string): TableGroup[];

  // Membership
  addTableToGroup(groupId: string, tableId: string): void;
  removeTableFromGroup(groupId: string, tableId: string): void;

  // Properties
  setGroupColor(groupId: string, color: string): void;
  setGroupIdentifier(groupId: string, identifier: string): void;

  // Seats
  getGroupSeats(groupId: string): Seat[];
  getGroupSeatCount(groupId: string): number;

  // Cross-room
  getGroupRooms(groupId: string): string[];
  isCrossRoomGroup(groupId: string): boolean;

  // Initialization
  initializeGroups(groups: TableGroup[]): void;
  clearAll(): void;
}

/**
 * Create a physical merge group
 * Tables snap together, share color, seats renumber sequentially
 */
function createPhysicalMerge(tableIds: string[]): TableGroup {
  if (tableIds.length < 2) {
    throw new Error('Physical merge requires at least 2 tables');
  }

  // Check if any tables are already grouped
  for (const tableId of tableIds) {
    if (tableToGroupMap.has(tableId)) {
      throw new Error(`Table ${tableId} is already in a group`);
    }
  }

  // TODO: Get tables from TableAPI to validate they're in same room
  // TODO: Calculate snap positions using mergeLogic
  // TODO: Update table positions via TableAPI

  const groupId = `group-${groupIdCounter++}`;
  const color = getNextAvailableColor();

  const group: TableGroup = {
    id: groupId,
    locationId: '', // TODO: Get from tables
    tableIds: [...tableIds],
    primaryTableId: tableIds[0],
    isVirtual: false,
    color,
    identifier: '',
    combinedCapacity: 0, // TODO: Calculate from seats
    isActive: true,
    createdAt: new Date(),
    createdBy: '', // TODO: Get from context
  };

  groups.set(groupId, group);

  // Update table-to-group mapping
  for (const tableId of tableIds) {
    tableToGroupMap.set(tableId, groupId);
  }

  // TODO: Call SeatAPI.renumberSeatsForMerge(tableIds)
  // TODO: Call TableAPI.setTableColor(tableId, color) for each table
  // TODO: Call TableAPI.updateTable to set groupId

  return group;
}

/**
 * Create a virtual group
 * Tables stay in place but are linked for ordering
 */
function createVirtualGroup(tableIds: string[]): TableGroup {
  if (tableIds.length < 2) {
    throw new Error('Virtual group requires at least 2 tables');
  }

  // Check if any tables are already grouped
  for (const tableId of tableIds) {
    if (tableToGroupMap.has(tableId)) {
      throw new Error(`Table ${tableId} is already in a group`);
    }
  }

  const groupId = `group-${groupIdCounter++}`;
  const color = getNextAvailableColor();

  const group: TableGroup = {
    id: groupId,
    locationId: '', // TODO: Get from tables
    tableIds: [...tableIds],
    primaryTableId: tableIds[0],
    isVirtual: true,
    color,
    identifier: '',
    combinedCapacity: 0, // TODO: Calculate from seats
    isActive: true,
    createdAt: new Date(),
    createdBy: '', // TODO: Get from context
  };

  groups.set(groupId, group);

  // Update table-to-group mapping
  for (const tableId of tableIds) {
    tableToGroupMap.set(tableId, groupId);
  }

  // TODO: Call TableAPI.setTableColor(tableId, color) for each table
  // TODO: Call TableAPI.updateTable to set groupId
  // NOTE: Tables do NOT move for virtual groups

  return group;
}

/**
 * Dissolve a group and restore tables to ungrouped state
 */
function dissolveGroup(groupId: string): void {
  const group = groups.get(groupId);
  if (!group) {
    throw new Error(`Group ${groupId} not found`);
  }

  // Release color back to pool
  releaseColor(group.color);

  // Remove table mappings
  for (const tableId of group.tableIds) {
    tableToGroupMap.delete(tableId);
  }

  // TODO: For physical merges, restore original table positions
  // TODO: Call TableAPI.setTableColor(tableId, null) to clear color
  // TODO: Call TableAPI.updateTable to clear groupId
  // TODO: Call SeatAPI to restore original seat numbering

  // Mark group as inactive
  group.isActive = false;
  groups.delete(groupId);
}

/**
 * Get a specific group by ID
 */
function getGroup(groupId: string): TableGroup | null {
  return groups.get(groupId) || null;
}

/**
 * Get the group that a table belongs to
 */
function getGroupForTable(tableId: string): TableGroup | null {
  const groupId = tableToGroupMap.get(tableId);
  if (!groupId) return null;
  return groups.get(groupId) || null;
}

/**
 * Get all active groups
 */
function getAllActiveGroups(): TableGroup[] {
  return Array.from(groups.values()).filter((g) => g.isActive);
}

/**
 * Get all groups in a specific room
 */
function getGroupsInRoom(_roomId: string): TableGroup[] {
  // TODO: Filter by room using TableAPI to check table locations
  return getAllActiveGroups();
}

/**
 * Add a table to an existing group
 */
function addTableToGroup(groupId: string, tableId: string): void {
  const group = groups.get(groupId);
  if (!group) {
    throw new Error(`Group ${groupId} not found`);
  }

  if (tableToGroupMap.has(tableId)) {
    throw new Error(`Table ${tableId} is already in a group`);
  }

  group.tableIds.push(tableId);
  tableToGroupMap.set(tableId, groupId);

  // TODO: Update table position if physical merge
  // TODO: Call TableAPI.setTableColor(tableId, group.color)
  // TODO: Call SeatAPI.renumberSeatsForMerge if needed
}

/**
 * Remove a table from a group
 */
function removeTableFromGroup(groupId: string, tableId: string): void {
  const group = groups.get(groupId);
  if (!group) {
    throw new Error(`Group ${groupId} not found`);
  }

  const index = group.tableIds.indexOf(tableId);
  if (index === -1) {
    throw new Error(`Table ${tableId} not in group ${groupId}`);
  }

  group.tableIds.splice(index, 1);
  tableToGroupMap.delete(tableId);

  // TODO: Restore table to original position if physical merge
  // TODO: Call TableAPI.setTableColor(tableId, null)

  // If only one table left, dissolve the group
  if (group.tableIds.length < 2) {
    dissolveGroup(groupId);
  }
}

/**
 * Set the color for a group
 */
function setGroupColor(groupId: string, color: string): void {
  const group = groups.get(groupId);
  if (!group) {
    throw new Error(`Group ${groupId} not found`);
  }

  // Release old color
  releaseColor(group.color);

  // Set new color
  group.color = color;
  markColorInUse(color);

  // TODO: Update all table colors via TableAPI
}

/**
 * Set the identifier for a group
 */
function setGroupIdentifier(groupId: string, identifier: string): void {
  const group = groups.get(groupId);
  if (!group) {
    throw new Error(`Group ${groupId} not found`);
  }

  group.identifier = identifier;
}

/**
 * Get all seats for a group (across all tables)
 */
function getGroupSeats(groupId: string): Seat[] {
  const group = groups.get(groupId);
  if (!group) {
    return [];
  }

  // TODO: Call SeatAPI.getSeatsForTable for each table and combine
  return [];
}

/**
 * Get total seat count for a group
 */
function getGroupSeatCount(groupId: string): number {
  const group = groups.get(groupId);
  if (!group) {
    return 0;
  }

  // TODO: Sum seat counts from all tables
  return group.combinedCapacity;
}

/**
 * Get all unique room IDs that tables in this group belong to
 */
function getGroupRooms(groupId: string): string[] {
  const group = groups.get(groupId);
  if (!group) {
    return [];
  }

  // TODO: Get room IDs from tables via TableAPI
  // For now, return empty array
  return [];
}

/**
 * Check if a group spans multiple rooms
 */
function isCrossRoomGroup(groupId: string): boolean {
  const rooms = getGroupRooms(groupId);
  return rooms.length > 1;
}

/**
 * Initialize groups from database
 */
function initializeGroups(loadedGroups: TableGroup[]): void {
  clearAll();

  for (const group of loadedGroups) {
    groups.set(group.id, group);

    // Mark color as in use
    markColorInUse(group.color);

    // Update table-to-group mapping
    for (const tableId of group.tableIds) {
      tableToGroupMap.set(tableId, group.id);
    }
  }
}

/**
 * Clear all groups and reset state
 */
function clearAll(): void {
  groups.clear();
  tableToGroupMap.clear();
  clearColorAssignments();
  groupIdCounter = 1;
}

/**
 * Export API instance
 */
export const tableGroupAPI: TableGroupAPI = {
  createPhysicalMerge,
  createVirtualGroup,
  dissolveGroup,
  getGroup,
  getGroupForTable,
  getAllActiveGroups,
  getGroupsInRoom,
  addTableToGroup,
  removeTableFromGroup,
  setGroupColor,
  setGroupIdentifier,
  getGroupSeats,
  getGroupSeatCount,
  getGroupRooms,
  isCrossRoomGroup,
  initializeGroups,
  clearAll,
};
