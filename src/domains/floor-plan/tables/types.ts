/**
 * GWI POS - Floor Plan Domain
 * Layer 2: Tables & Smart Objects Types
 *
 * Layer-specific types for the tables layer.
 * Most types are imported from shared/types.ts
 */

import type {
  Table,
  ObjectType,
  ObjectCategory,
  TableShape,
  EntertainmentConfig,
} from '../shared/types';

// Re-export shared types for convenience
export type {
  Table,
  ObjectType,
  ObjectCategory,
  TableShape,
  EntertainmentConfig,
};

/**
 * Helper type for table creation (omits auto-generated fields)
 */
export type CreateTableInput = Omit<Table, 'id'>;

/**
 * Helper type for table updates (all fields optional)
 */
export type UpdateTableInput = Partial<Table>;

/**
 * Table drag state for UI interactions
 */
export interface TableDragState {
  tableId: string;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Table selection state
 */
export interface TableSelectionState {
  selectedTableIds: string[];
  lastSelectedId: string | null;
}
