/**
 * GWI POS - Floor Plan Domain
 * Layer 2: Tables & Smart Objects API
 *
 * Manages all objects placed on the floor plan — dining tables, bar stools,
 * pool tables, decorations. Handles object creation, positioning, dragging, and properties.
 */

import type {
  Table,
  ObjectCategory,
  Point,
} from '../shared/types';
import { FloorCanvasAPI } from '../canvas';

// =============================================================================
// STATE (In production, this would come from the database)
// =============================================================================

let tables: Map<string, Table> = new Map();

// =============================================================================
// CRUD OPERATIONS
// =============================================================================

/**
 * Create a new table
 */
export function createTable(data: Omit<Table, 'id'>): Table {
  const id = `tbl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const table: Table = {
    id,
    ...data,
  };
  tables.set(id, table);
  return table;
}

/**
 * Get a table by ID
 */
export function getTable(tableId: string): Table | null {
  return tables.get(tableId) ?? null;
}

/**
 * Update a table
 */
export function updateTable(tableId: string, updates: Partial<Table>): void {
  const table = tables.get(tableId);
  if (table) {
    tables.set(tableId, { ...table, ...updates });
  }
}

/**
 * Delete a table
 */
export function deleteTable(tableId: string): void {
  tables.delete(tableId);
}

// =============================================================================
// QUERY METHODS
// =============================================================================

/**
 * Get all tables for a room
 */
export function getTablesForRoom(roomId: string): Table[] {
  return Array.from(tables.values())
    .filter((t) => t.floorPlanId === roomId && t.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Get all tables for a section
 */
export function getTablesForSection(sectionId: string): Table[] {
  return Array.from(tables.values())
    .filter((t) => t.sectionId === sectionId && t.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Get tables by category
 */
export function getTablesByCategory(category: ObjectCategory): Table[] {
  return Array.from(tables.values())
    .filter((t) => t.category === category && t.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Get all entertainment objects (pool tables, darts, etc.)
 */
export function getEntertainmentObjects(): Table[] {
  return getTablesByCategory('entertainment');
}

/**
 * Get all seatable tables (dining tables, booths, bar stools, etc.)
 */
export function getSeatableTables(): Table[] {
  return getTablesByCategory('seatable');
}

/**
 * Get all active tables (regardless of room)
 */
export function getAllTables(): Table[] {
  return Array.from(tables.values()).filter((t) => t.isActive);
}

// =============================================================================
// POSITION & MOVEMENT
// =============================================================================

/**
 * Move a table to a new position
 * Returns false if the position is blocked, true if successful
 */
export function moveTable(tableId: string, newPosition: Point): boolean {
  const table = tables.get(tableId);
  if (!table) return false;

  // Check collision with Layer 1's collision detection
  const isBlocked = FloorCanvasAPI.isPositionBlocked(
    table.floorPlanId,
    newPosition,
    table.width,
    table.height
  );

  if (isBlocked) {
    return false;
  }

  // Update position
  updateTable(tableId, {
    positionX: newPosition.x,
    positionY: newPosition.y,
  });

  return true;
}

/**
 * Rotate a table by degrees
 */
export function rotateTable(tableId: string, degrees: number): void {
  const table = tables.get(tableId);
  if (!table) return;

  // Normalize rotation to 0-359 degrees
  const newRotation = ((table.rotation + degrees) % 360 + 360) % 360;

  updateTable(tableId, { rotation: newRotation });
}

// =============================================================================
// CAPACITY MANAGEMENT
// =============================================================================

/**
 * Set the capacity of a table
 */
export function setTableCapacity(tableId: string, capacity: number): void {
  const table = tables.get(tableId);
  if (!table) return;

  // Ensure capacity is within min/max bounds
  const validCapacity = Math.max(
    table.minCapacity,
    Math.min(capacity, table.maxCapacity)
  );

  updateTable(tableId, { defaultCapacity: validCapacity });
}

// =============================================================================
// VISUAL PROPERTIES
// =============================================================================

/**
 * Set the color of a table
 */
export function setTableColor(tableId: string, color: string): void {
  updateTable(tableId, { color });
}

// =============================================================================
// BULK OPERATIONS
// =============================================================================

/**
 * Bulk update multiple tables
 */
export function bulkUpdateTables(
  updates: { tableId: string; changes: Partial<Table> }[]
): void {
  for (const { tableId, changes } of updates) {
    updateTable(tableId, changes);
  }
}

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Initialize tables from the database
 */
export function initializeTables(tableList: Table[]): void {
  tables.clear();
  for (const table of tableList) {
    tables.set(table.id, table);
  }
}

/**
 * Clear all tables (for testing)
 */
export function clearAll(): void {
  tables.clear();
}

// =============================================================================
// EXPORT THE API
// =============================================================================

export const TableAPI = {
  // CRUD
  createTable,
  getTable,
  updateTable,
  deleteTable,

  // Queries
  getTablesForRoom,
  getTablesForSection,
  getTablesByCategory,
  getEntertainmentObjects,
  getSeatableTables,
  getAllTables,

  // Position & movement
  moveTable,
  rotateTable,

  // Capacity
  setTableCapacity,

  // Visual
  setTableColor,

  // Bulk operations
  bulkUpdateTables,

  // Initialization
  initializeTables,
  clearAll,
};

export default TableAPI;
