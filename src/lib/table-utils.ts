/**
 * Table Utilities - Helpers for floor plan table operations
 *
 * Provides:
 * - Type mappers between FloorPlanTableType and TableRect
 * - Seat count helpers
 */

import type { FloorPlanTableType } from '@/components/floor-plan'
import type { TableRect } from '@/lib/table-geometry'

/**
 * Maps a FloorPlanTableType to a TableRect for geometry calculations.
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
 * Get total seat count for a table.
 *
 * @param table - Table to count seats for
 * @returns Seat count
 */
export function getTotalSeats(table: FloorPlanTableType): number {
  return table.seats ? table.seats.length : 0
}

