/**
 * GWI POS - Floor Plan Domain
 * Admin Editor
 *
 * Public exports for the floor plan admin editor.
 */

// In-memory version (for testing)
export { FloorPlanEditor } from './FloorPlanEditor';
export { EditorCanvas } from './EditorCanvas';
export { FixtureToolbar } from './FixtureToolbar';
export { FixtureProperties } from './FixtureProperties';

// Table components
export { TableRenderer } from './TableRenderer';
export { TableProperties } from './TableProperties';

// Database-backed version (production)
export { FloorPlanEditorDB } from './FloorPlanEditorDB';
export { EditorCanvasDB } from './EditorCanvasDB';
export { FixturePropertiesDB } from './FixturePropertiesDB';

// Re-export types
export type {
  EditorToolMode,
  FixtureType,
  DrawingState,
  SelectionState,
  EditorState,
  FixtureTypeMetadata,
  // Table types
  TableShape,
  SeatPattern,
  EditorTable,
  EditorSeat,
  TableTypeMetadata,
} from './types';

export {
  FIXTURE_TYPES,
  FIXTURE_TYPE_MAP,
  getFixtureTypeMetadata,
  // Table exports
  TABLE_SHAPES,
  TABLE_SHAPE_MAP,
  getTableShapeMetadata,
} from './types';
