/**
 * GWI POS - Floor Plan Domain
 * Layer 2: Tables & Smart Objects
 *
 * Public exports for the tables layer.
 */

export { Table } from './Table';
export { SmartObject } from './SmartObject';
export { TableAPI, default as tableAPI } from './tableAPI';

// Re-export types
export type {
  Table as TableType,
  ObjectType,
  ObjectCategory,
  TableShape,
  EntertainmentConfig,
  CreateTableInput,
  UpdateTableInput,
  TableDragState,
  TableSelectionState,
} from './types';
