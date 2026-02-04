/**
 * Table Utilities - Helpers for floor plan table operations
 *
 * Provides:
 * - Type mappers between FloorPlanTableType and TableRect
 * - Primary table resolution for combined groups
 * - Group type detection (physical vs virtual)
 */

import type { FloorPlanTableType } from '@/components/floor-plan'
import type { TableRect } from '@/lib/table-geometry'
import { getCombinedGroupTables, getExposedEdges } from '@/lib/table-geometry'

/**
 * Maps a FloorPlanTableType to a TableRect for geometry calculations.
 * Only includes fields needed by geometry helpers (getCombinedGroupTables,
 * getExposedEdges, distributeSeatsOnPerimeter, calculatePerimeterCapacity).
 *
 * @param table - Full floor plan table with all fields
 * @returns Minimal TableRect for geometry operations
 */
export function toTableRect(table: FloorPlanTableType): TableRect {
  return {
    id: table.id,
    posX: table.posX,
    posY: table.posY,
    width: table.width,
    height: table.height,
    combinedWithId: table.combinedWithId ?? null,
    combinedTableIds: table.combinedTableIds ?? null,
  }
}

/**
 * Maps an array of FloorPlanTableType to TableRect[] for batch geometry operations.
 *
 * @param tables - Array of full floor plan tables
 * @returns Array of minimal TableRects
 */
export function toTableRectArray(tables: FloorPlanTableType[]): TableRect[] {
  return tables.map(toTableRect)
}

/**
 * Get the primary table ID for a combined group.
 * If the table is a secondary (has combinedWithId), returns the primary's ID.
 * Otherwise returns the table's own ID.
 *
 * @param table - Any table in a combined group
 * @returns The primary table's ID
 */
export function getPrimaryTableId(table: FloorPlanTableType): string {
  return table.combinedWithId || table.id
}

/**
 * Get the primary table object for a combined group.
 * Resolves secondary tables to their primary.
 *
 * @param table - Any table in a combined group
 * @param allTables - All tables to search
 * @returns The primary table, or the original table if not combined
 */
export function getPrimaryTable(
  table: FloorPlanTableType,
  allTables: FloorPlanTableType[]
): FloorPlanTableType {
  if (!table.combinedWithId) return table
  return allTables.find(t => t.id === table.combinedWithId) || table
}

/**
 * Check if a table is part of a physical combined group.
 * Physical groups are created via magnetic snap docking (T, L, U shapes).
 *
 * @param table - Table to check
 * @returns true if table is in a physical combined group
 */
export function isPhysicalGroup(table: FloorPlanTableType): boolean {
  return !!(table.combinedWithId || (table.combinedTableIds && table.combinedTableIds.length > 0))
}

/**
 * Check if a table is part of a virtual combined group.
 * Virtual groups are order-linked (no geometry changes).
 *
 * @param table - Table to check
 * @returns true if table is in a virtual combined group
 */
export function isVirtualGroup(table: FloorPlanTableType): boolean {
  return !!table.virtualGroupId
}

/**
 * Check if a table is the primary in its combined group.
 *
 * @param table - Table to check
 * @returns true if table is primary (has combinedTableIds) or not combined at all
 */
export function isPrimaryTable(table: FloorPlanTableType): boolean {
  // A table is primary if it has no combinedWithId (not linked to another)
  // and either has combinedTableIds or is standalone
  return !table.combinedWithId
}

/**
 * Get all table IDs in a combined group (including the primary).
 *
 * @param table - Any table in the group
 * @param allTables - All tables to search
 * @returns Array of table IDs in the group
 */
export function getCombinedGroupIds(
  table: FloorPlanTableType,
  allTables: FloorPlanTableType[]
): string[] {
  const primary = getPrimaryTable(table, allTables)
  const ids = [primary.id]

  if (primary.combinedTableIds) {
    ids.push(...primary.combinedTableIds)
  }

  return ids
}

/**
 * Calculate total seats for a table (including combined group members).
 *
 * By default, sums seats.length for all tables in the physical group.
 * With usePerimeterFallback = true, estimates capacity from exposed perimeter
 * and uses that only if it's larger than current seat count.
 *
 * Example: Two 4-tops joined side-by-side:
 * - Default (usePerimeterFallback = false): 4 + 4 = 8 seats
 * - With perimeter fallback: ~6 seats (based on exposed edges)
 *
 * @param table - Any table in a group (will resolve to primary)
 * @param allTables - All tables to search
 * @param usePerimeterFallback - If true, use perimeter-based capacity when larger
 * @returns Total seat count for the table/group
 */
export function getTotalSeats(
  table: FloorPlanTableType,
  allTables: FloorPlanTableType[],
  usePerimeterFallback: boolean = false
): number {
  // Resolve to primary table first
  const primary = getPrimaryTable(table, allTables)
  if (!primary) return 0

  // Get all tables in the physical group
  const groupRect = toTableRect(primary)
  const allRects = toTableRectArray(allTables)
  const groupTables = getCombinedGroupTables(groupRect, allRects)

  // Map back to full table objects for seats
  const groupFull = groupTables
    .map(rect => allTables.find(t => t.id === rect.id))
    .filter((t): t is FloorPlanTableType => !!t)

  // Sum actual seats across all tables in the group
  const actualSeats = groupFull.reduce(
    (sum, t) => sum + (t.seats ? t.seats.length : 0),
    0
  )

  // Simple case: just sum real seats
  if (!usePerimeterFallback || groupTables.length <= 1) {
    return actualSeats
  }

  // Optional: estimate from exposed perimeter length
  let totalExposedLength = 0
  for (const rect of groupTables) {
    const edges = getExposedEdges(rect, groupTables)
    edges.forEach(e => {
      const len = Math.hypot(e.end.x - e.start.x, e.end.y - e.start.y)
      totalExposedLength += len
    })
  }

  // Guard against degenerate cases
  if (totalExposedLength <= 1) {
    return actualSeats
  }

  // px per seat, tune per design (65px works well for standard tables)
  const approxPerSeat = 65
  const perimeterSeats = Math.floor(totalExposedLength / approxPerSeat)

  // Never shrink below existing seats; only increase if perimeter suggests more
  return Math.max(actualSeats, perimeterSeats)
}

/**
 * Renumber seats sequentially across a combined group.
 * Seats are numbered by table position (top-left first), then by seat index.
 *
 * @param groupTables - All tables in the combined group
 * @returns Updated tables with renumbered seats
 */
export function renumberGroupSeats(groupTables: FloorPlanTableType[]): FloorPlanTableType[] {
  // Sort tables by position (top-left first)
  const sorted = [...groupTables].sort((a, b) => {
    if (a.posY !== b.posY) return a.posY - b.posY
    return a.posX - b.posX
  })

  let seatNumber = 1

  return sorted.map(table => {
    if (!table.seats || table.seats.length === 0) return table

    const renumberedSeats = table.seats.map(seat => ({
      ...seat,
      seatNumber: seatNumber++,
      label: String(seatNumber - 1),
    }))

    return { ...table, seats: renumberedSeats }
  })
}

